/**
 * Two-way sync between the `9router.apiKeys.keys` setting and the server's
 * API keys (`/api/keys`). The server is the source of truth:
 *
 * - Server → VS Code: after every refresh the setting is rewritten to mirror
 *   the server (guarded so it doesn't trigger a push).
 * - VS Code → server: editing the setting creates, enables/disables or
 *   deletes keys. Deletions require a modal confirmation; anything rejected
 *   or failed is reverted by re-pulling from the server.
 *
 * Also resolves the key used by Copilot (`9router.copilot.apiKey`, a label).
 */
import * as vscode from 'vscode';
import { ConnectionManager } from '../connection/connectionManager';
import { COPILOT_SECTION, getCopilotApiKeyLabel, setCopilotApiKeyLabel } from '../copilot/copilotConfig';
import { errorMessage } from '../dashboard/errors';
import { maskKey } from '../dashboard/http';
import { ApiKey } from '../dashboard/types';
import {
  ApiKeysSetting,
  buildLabels,
  diffApiKeys,
  isEmptyDiff,
  settingsEqual,
  toSettingValue,
} from './apiKeysMapping';

export const API_KEYS_SECTION = '9router.apiKeys';
const KEYS_SETTING = 'keys';
const PUSH_DEBOUNCE_MS = 600;

export class ApiKeysSync implements vscode.Disposable {
  private labels: Map<string, ApiKey> = new Map();
  private loaded = false;
  private applyingFromServer = 0;
  private pushTimer: ReturnType<typeof setTimeout> | undefined;
  private chain: Promise<void> = Promise.resolve();
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;
  private readonly disposables: vscode.Disposable[] = [this._onDidChange];

  constructor(
    private readonly connection: ConnectionManager,
    private readonly log: (message: string) => void
  ) {
    this.disposables.push(
      connection.onDidChangeState((state) => {
        if (state.kind === 'connected') {
          void this.refresh();
        } else if (state.kind === 'signedOut') {
          this.labels = new Map();
          this.loaded = false;
          this._onDidChange.fire();
        }
      }),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration(`${API_KEYS_SECTION}.${KEYS_SETTING}`) && this.applyingFromServer === 0) {
          this.schedulePush();
        }
        if (e.affectsConfiguration(`${COPILOT_SECTION}.apiKey`)) {
          void this.cacheCopilotKey().finally(() => this._onDidChange.fire());
        }
      })
    );
  }

  /** Label → key, in server order. */
  public getLabeledKeys(): ReadonlyMap<string, ApiKey> {
    return this.labels;
  }

  public labelOf(id: string): string | undefined {
    for (const [label, key] of this.labels) {
      if (key.id === id) {
        return label;
      }
    }
    return undefined;
  }

  /** Pull keys from the server and mirror them into the setting. */
  public refresh(options: { notify?: boolean } = {}): Promise<void> {
    return this.enqueue(() => this.doRefresh(options));
  }

  /** Create a key directly (used by the "Create API key" command). */
  public async create(name: string): Promise<ApiKey> {
    const key = await this.connection.client.createKey(name);
    await this.refresh();
    return key;
  }

  public async setActive(id: string, active: boolean): Promise<void> {
    await this.connection.client.setKeyActive(id, active);
    await this.refresh();
  }

  /** Resolve the secret value of the key Copilot should use. */
  public async resolveCopilotKey(): Promise<string | undefined> {
    const label = getCopilotApiKeyLabel();
    const serverUrl = this.connection.getServerUrl();
    if (!label || !serverUrl) {
      return undefined;
    }
    const live = this.labels.get(label);
    if (live) {
      return live.key;
    }
    return this.connection.store.getCopilotKey(serverUrl, label);
  }

  // ── internals ────────────────────────────────────────────────────────────

  private enqueue(fn: () => Promise<void>): Promise<void> {
    const next = this.chain.then(fn, fn);
    this.chain = next.catch(() => undefined);
    return next;
  }

  private async doRefresh(options: { notify?: boolean }): Promise<void> {
    if (!this.connection.isConnected()) {
      if (options.notify) {
        void vscode.window.showWarningMessage('9Router: sign in first to load API keys.');
      }
      return;
    }
    try {
      const keys = await this.connection.client.listKeys();
      this.labels = buildLabels(keys);
      this.loaded = true;
      await this.writeSetting(toSettingValue(this.labels));
      await this.cacheCopilotKey();
      if (options.notify) {
        void vscode.window.showInformationMessage(`9Router: loaded ${keys.length} API key(s) from the server.`);
      }
    } catch (error) {
      this.connection.reportError(error);
      this.log(`Failed to load API keys: ${errorMessage(error)}`);
      if (options.notify) {
        void vscode.window.showErrorMessage(`9Router: ${errorMessage(error)}`);
      }
    }
    this._onDidChange.fire();
  }

  private schedulePush(): void {
    if (this.pushTimer) {
      clearTimeout(this.pushTimer);
    }
    this.pushTimer = setTimeout(() => {
      this.pushTimer = undefined;
      void this.enqueue(() => this.push());
    }, PUSH_DEBOUNCE_MS);
  }

  private async push(): Promise<void> {
    if (!this.connection.isConnected() || !this.loaded) {
      const choice = await vscode.window.showWarningMessage(
        '9Router: API keys are stored on the server. Sign in to apply this change (it will be discarded otherwise).',
        'Sign In'
      );
      if (choice === 'Sign In') {
        await vscode.commands.executeCommand('9router.signIn');
      }
      return;
    }

    const local = this.readSetting();
    const diff = diffApiKeys(local, this.labels);
    if (isEmptyDiff(diff)) {
      return;
    }

    if (diff.remove.length > 0) {
      const copilotLabel = getCopilotApiKeyLabel();
      const lines = diff.remove.map(
        (r) => `• ${r.label} (${maskKey(r.key.key)})${r.label === copilotLabel ? ' — used by Copilot' : ''}`
      );
      const renameHint =
        diff.create.length > 0
          ? '\n\nNote: keys cannot be renamed. Renaming an entry deletes the old key and creates a new one with a different value.'
          : '';
      const choice = await vscode.window.showWarningMessage(
        `Delete ${diff.remove.length} API key(s) on the 9Router server? Clients using them will stop working.`,
        { modal: true, detail: lines.join('\n') + renameHint },
        'Delete'
      );
      if (choice !== 'Delete') {
        this.log('API key deletion cancelled; restoring setting from server.');
        await this.doRefresh({});
        return;
      }
    }

    const client = this.connection.client;
    const created: ApiKey[] = [];
    try {
      for (const t of diff.toggle) {
        this.log(`API key ${t.label}: ${t.active ? 'enable' : 'disable'}`);
        await client.setKeyActive(t.key.id, t.active);
      }
      for (const c of diff.create) {
        this.log(`API key create: ${c.name}`);
        const key = await client.createKey(c.name);
        if (!c.active && key.id) {
          await client.setKeyActive(key.id, false);
        }
        created.push(key);
      }
      for (const r of diff.remove) {
        this.log(`API key delete: ${r.label}`);
        await client.deleteKey(r.key.id);
        if (getCopilotApiKeyLabel() === r.label) {
          await setCopilotApiKeyLabel('');
        }
      }
    } catch (error) {
      this.connection.reportError(error);
      void vscode.window.showErrorMessage(`9Router: failed to update API keys. ${errorMessage(error)}`);
    }

    await this.doRefresh({});

    for (const key of created) {
      void vscode.window
        .showInformationMessage(`9Router: created API key "${key.name}" (${maskKey(key.key)}).`, 'Copy Key', 'Use for Copilot')
        .then(async (choice) => {
          if (choice === 'Copy Key') {
            await vscode.env.clipboard.writeText(key.key);
          } else if (choice === 'Use for Copilot') {
            const label = this.labelOf(key.id);
            if (label) {
              await setCopilotApiKeyLabel(label);
            }
          }
        });
    }
  }

  private readSetting(): ApiKeysSetting {
    const value = vscode.workspace.getConfiguration(API_KEYS_SECTION).get<ApiKeysSetting>(KEYS_SETTING, {});
    return value && typeof value === 'object' ? { ...value } : {};
  }

  private async writeSetting(value: ApiKeysSetting): Promise<void> {
    if (settingsEqual(this.readSetting(), value)) {
      return;
    }
    this.applyingFromServer++;
    try {
      await vscode.workspace
        .getConfiguration(API_KEYS_SECTION)
        .update(KEYS_SETTING, value, vscode.ConfigurationTarget.Global);
    } finally {
      setTimeout(() => {
        this.applyingFromServer--;
      }, 0);
    }
  }

  private async cacheCopilotKey(): Promise<void> {
    const label = getCopilotApiKeyLabel();
    const serverUrl = this.connection.getServerUrl();
    if (!label || !serverUrl || !this.loaded) {
      return;
    }
    const live = this.labels.get(label);
    if (live) {
      await this.connection.store.setCopilotKey(serverUrl, { id: label, key: live.key });
    } else {
      this.log(`Copilot API key "${label}" does not exist on the server.`);
      await this.connection.store.setCopilotKey(serverUrl, undefined);
    }
  }

  public dispose(): void {
    if (this.pushTimer) {
      clearTimeout(this.pushTimer);
    }
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
