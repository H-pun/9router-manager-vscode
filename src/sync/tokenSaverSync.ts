/**
 * Two-way sync between `9router.tokenSaver.*` (VS Code settings) and the
 * connected 9Router server's settings (`GET/PATCH /api/settings`).
 *
 * - Server → VS Code: on connect, on window focus, periodically, and on demand.
 * - VS Code → server: on `onDidChangeConfiguration` for the section.
 * - Loop guard: writes coming from the server are flagged so the resulting
 *   configuration-change events are ignored; values are compared first.
 * - The server is the source of truth: if a PATCH fails, local settings are
 *   reverted to the last known server values.
 */
import * as vscode from 'vscode';
import { ConnectionManager } from '../connection/connectionManager';
import { errorMessage } from '../dashboard/errors';
import {
  TOKEN_SAVER_FIELDS,
  TokenSaverValues,
  changedSettings,
  diffToServerPatch,
  fromServer,
} from './tokenSaverMapping';

export const TOKEN_SAVER_SECTION = '9router.tokenSaver';
const PUSH_DEBOUNCE_MS = 400;

export class TokenSaverSync implements vscode.Disposable {
  private lastServer: TokenSaverValues | undefined;
  private applyingFromServer = 0;
  private pushTimer: ReturnType<typeof setTimeout> | undefined;
  private pushChain: Promise<void> = Promise.resolve();
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly connection: ConnectionManager,
    private readonly log: (message: string) => void
  ) {
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration(TOKEN_SAVER_SECTION) && this.applyingFromServer === 0) {
          this.schedulePush();
        }
      }),
      connection.onDidChangeState((state) => {
        if (state.kind === 'connected') {
          void this.pull();
        } else {
          this.lastServer = undefined;
        }
      })
    );
  }

  /** Pull server values into VS Code settings. */
  public async pull(options: { notify?: boolean } = {}): Promise<void> {
    if (!this.connection.isConnected()) {
      if (options.notify) {
        void vscode.window.showWarningMessage('9Router: sign in first to sync Token Saver settings.');
      }
      return;
    }
    try {
      const settings = await this.connection.client.getSettings();
      const serverValues = fromServer(settings);
      this.lastServer = serverValues;
      const changed = await this.applyLocal(serverValues);
      if (changed.length > 0) {
        this.log(`Token Saver pulled from server: ${changed.join(', ')}`);
      }
      if (options.notify) {
        void vscode.window.showInformationMessage(
          changed.length > 0
            ? `9Router: Token Saver updated from server (${changed.join(', ')}).`
            : '9Router: Token Saver settings already match the server.'
        );
      }
    } catch (error) {
      this.connection.reportError(error);
      this.log(`Token Saver pull failed: ${errorMessage(error)}`);
      if (options.notify) {
        void vscode.window.showErrorMessage(`9Router: ${errorMessage(error)}`);
      }
    }
  }

  private schedulePush(): void {
    if (this.pushTimer) {
      clearTimeout(this.pushTimer);
    }
    this.pushTimer = setTimeout(() => {
      this.pushTimer = undefined;
      // Serialize pushes so rapid toggles are applied in order.
      this.pushChain = this.pushChain.then(() => this.push());
    }, PUSH_DEBOUNCE_MS);
  }

  private async push(): Promise<void> {
    if (!this.connection.isConnected()) {
      void vscode.window
        .showWarningMessage(
          '9Router: Token Saver settings are applied on the server. Sign in to apply this change.',
          'Sign In'
        )
        .then((choice) => {
          if (choice === 'Sign In') {
            void vscode.commands.executeCommand('9router.signIn');
          }
        });
      return;
    }
    if (!this.lastServer) {
      // Never pushed blindly: fetch server state first so we only send real diffs.
      await this.pull();
      if (!this.lastServer) {
        return;
      }
    }
    const local = this.readLocal();
    const patch = diffToServerPatch(local, this.lastServer);
    if (!patch) {
      return;
    }
    try {
      this.log(`Token Saver push: ${JSON.stringify(patch)}`);
      const updated = await this.connection.client.patchSettings(patch);
      this.lastServer = fromServer(updated);
      // Server may normalize values; reflect them back.
      await this.applyLocal(this.lastServer);
    } catch (error) {
      this.connection.reportError(error);
      const message = errorMessage(error);
      this.log(`Token Saver push failed: ${message}`);
      void vscode.window.showErrorMessage(`9Router: failed to apply Token Saver setting. ${message}`);
      await this.applyLocal(this.lastServer);
    }
  }

  private readLocal(): TokenSaverValues {
    const config = vscode.workspace.getConfiguration(TOKEN_SAVER_SECTION);
    const out: TokenSaverValues = {};
    for (const field of TOKEN_SAVER_FIELDS) {
      const value = config.get<boolean | string>(field.setting);
      if (value !== undefined) {
        out[field.setting] = value;
      }
    }
    return out;
  }

  /** Write server values into Global settings, skipping unchanged ones. */
  private async applyLocal(serverValues: TokenSaverValues): Promise<string[]> {
    const changed = changedSettings(this.readLocal(), serverValues);
    if (changed.length === 0) {
      return changed;
    }
    const config = vscode.workspace.getConfiguration(TOKEN_SAVER_SECTION);
    this.applyingFromServer++;
    try {
      for (const setting of changed) {
        await config.update(setting, serverValues[setting], vscode.ConfigurationTarget.Global);
      }
    } finally {
      // Configuration change events are delivered asynchronously after update
      // resolves; release the guard on the next tick.
      setTimeout(() => {
        this.applyingFromServer--;
      }, 0);
    }
    return changed;
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
