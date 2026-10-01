/**
 * Quota Tracker state holder: loads quota-eligible provider accounts,
 * fetches per-account quota with limited concurrency, toggles accounts
 * on/off (`PUT /api/providers/:id { isActive }`), and auto-refreshes while
 * someone is watching.
 */
import * as vscode from 'vscode';
import { ConnectionManager } from '../connection/connectionManager';
import { errorMessage } from '../dashboard/errors';
import { ProviderConnection } from '../dashboard/types';
import { AccountQuota, QuotaFilter, QuotaViewState } from './protocol';
import {
  QuotaVisibility,
  accountLabel,
  groupConnections,
  hiddenKeys,
  parseUsageResponse,
  updateVisibility,
} from './quotaMapping';

export const QUOTA_SECTION = '9router.quota';
const MAX_CONCURRENT_FETCHES = 4;

export class QuotaService implements vscode.Disposable {
  private connections: ProviderConnection[] = [];
  private readonly quotas = new Map<string, AccountQuota>();
  private readonly toggling = new Set<string>();
  private readonly testing = new Set<string>();
  private visibility: QuotaVisibility = {};
  private loadingList = false;
  private listError: string | undefined;
  private lastRefreshAt: number | undefined;
  private autoTimer: ReturnType<typeof setInterval> | undefined;
  private watchers = 0;
  private refreshGeneration = 0;

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
          if (this.watchers > 0) {
            void this.refreshAll(false);
          }
        } else if (state.kind === 'signedOut') {
          this.connections = [];
          this.quotas.clear();
          this.listError = undefined;
        }
        this._onDidChange.fire();
      }),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration(`${QUOTA_SECTION}.autoRefreshInterval`)) {
          this.scheduleAuto();
          this._onDidChange.fire();
        } else if (e.affectsConfiguration(`${QUOTA_SECTION}.filter`)) {
          this._onDidChange.fire();
        }
      })
    );
  }

  /** Register a visible consumer (sidebar view). Auto-refresh only runs while watched. */
  public watch(): vscode.Disposable {
    this.watchers++;
    this.scheduleAuto();
    if (this.connections.length === 0 && this.connection.isConnected() && !this.loadingList) {
      void this.refreshAll(false);
    }
    return new vscode.Disposable(() => {
      this.watchers = Math.max(0, this.watchers - 1);
      this.scheduleAuto();
    });
  }

  public getState(): QuotaViewState {
    const state = this.connection.getState();
    return {
      connection: state.kind,
      connectionMessage: state.kind === 'error' ? state.message : undefined,
      serverUrl: this.connection.getServerUrl(),
      loadingList: this.loadingList,
      listError: this.listError,
      groups: groupConnections(this.connections, (id) => this.visibleQuota(id)).map((g) => ({
        ...g,
        accounts: g.accounts.map((a) => ({
          ...a,
          toggling: this.toggling.has(a.id),
          testing: this.testing.has(a.id),
        })),
      })),
      lastRefreshAt: this.lastRefreshAt,
      autoRefreshSeconds: this.autoRefreshSeconds(),
      filter: this.getFilter(),
    };
  }

  /** Split rows into visible/hidden using the dashboard's `quotaVisibility`. */
  private visibleQuota(id: string): AccountQuota {
    const quota = this.quotaFor(id);
    const provider = this.connections.find((c) => c.id === id)?.provider;
    if (!provider || quota.rows.length === 0) {
      return quota;
    }
    const hidden = hiddenKeys(provider, this.visibility);
    if (hidden.size === 0) {
      return quota;
    }
    return {
      ...quota,
      rows: quota.rows.filter((r) => !hidden.has(r.key)),
      hiddenRows: quota.rows.filter((r) => hidden.has(r.key)),
    };
  }

  /** Hide/show a quota row. Persisted to the server like the web dashboard. */
  public async setQuotaHidden(provider: string, key: string, hide: boolean): Promise<void> {
    const previous = this.visibility;
    this.visibility = updateVisibility(previous, provider, key, hide);
    this._onDidChange.fire();
    try {
      await this.connection.client.patchSettings({ quotaVisibility: this.visibility });
    } catch (error) {
      this.connection.reportError(error);
      this.visibility = previous;
      this._onDidChange.fire();
      void vscode.window.showErrorMessage(`9Router: failed to update quota visibility. ${errorMessage(error)}`);
    }
  }

  private async loadVisibility(): Promise<void> {
    try {
      const settings = await this.connection.client.getSettings();
      const value = settings.quotaVisibility;
      this.visibility = value && typeof value === 'object' ? (value as QuotaVisibility) : {};
    } catch (error) {
      this.log(`Quota: failed to load quota visibility: ${errorMessage(error)}`);
    }
  }

  public getFilter(): QuotaFilter {
    const value = vscode.workspace.getConfiguration(QUOTA_SECTION).get<string>('filter', 'active');
    return value === 'all' || value === 'inactive' ? value : 'active';
  }

  public async setFilter(filter: QuotaFilter): Promise<void> {
    await vscode.workspace
      .getConfiguration(QUOTA_SECTION)
      .update('filter', filter, vscode.ConfigurationTarget.Global);
  }

  /** `POST /api/providers/:id/test`, with a toast for the result. */
  public async testAccount(id: string): Promise<void> {
    const c = this.connections.find((x) => x.id === id);
    if (!c || this.testing.has(id)) {
      return;
    }
    const label = accountLabel(c);
    this.testing.add(id);
    this._onDidChange.fire();
    try {
      const result = await this.connection.client.testConnection(id);
      if (result.valid) {
        void vscode.window.showInformationMessage(`9Router: "${label}" connection is valid.`);
      } else {
        void vscode.window.showErrorMessage(`9Router: test failed for "${label}" — ${result.error ?? 'unknown error'}`);
      }
    } catch (error) {
      this.connection.reportError(error);
      void vscode.window.showErrorMessage(`9Router: test failed for "${label}" — ${errorMessage(error)}`);
    } finally {
      this.testing.delete(id);
      this._onDidChange.fire();
    }
  }

  /** Reload the account list and every account's quota. */
  public async refreshAll(force: boolean): Promise<void> {
    if (!this.connection.isConnected()) {
      return;
    }
    const generation = ++this.refreshGeneration;
    this.loadingList = true;
    this._onDidChange.fire();
    try {
      const [connections] = await Promise.all([
        this.connection.client.listQuotaConnections(),
        this.loadVisibility(),
      ]);
      this.connections = connections;
      this.listError = undefined;
      const ids = new Set(this.connections.map((c) => c.id));
      for (const id of [...this.quotas.keys()]) {
        if (!ids.has(id)) {
          this.quotas.delete(id);
        }
      }
    } catch (error) {
      this.connection.reportError(error);
      this.listError = errorMessage(error);
      this.log(`Quota: failed to load accounts: ${this.listError}`);
      return;
    } finally {
      this.loadingList = false;
      this._onDidChange.fire();
    }

    if (generation !== this.refreshGeneration) {
      return;
    }
    const targets = this.connections.filter((c) => c.isActive !== false || this.includeInactive());
    await this.fetchMany(targets.map((c) => c.id), force);
    this.lastRefreshAt = Date.now();
    this._onDidChange.fire();
  }

  public async refreshAccount(id: string): Promise<void> {
    await this.fetchOne(id, true);
  }

  public async setAccountActive(id: string, active: boolean): Promise<void> {
    await this.setAccountsActive([id], active);
  }

  public async setProviderActive(provider: string, active: boolean): Promise<void> {
    const ids = this.connections.filter((c) => c.provider === provider).map((c) => c.id);
    await this.setAccountsActive(ids, active);
  }

  // ── internals ────────────────────────────────────────────────────────────

  private async setAccountsActive(ids: string[], active: boolean): Promise<void> {
    const pending = ids.filter((id) => {
      const c = this.connections.find((x) => x.id === id);
      return c && (c.isActive !== false) !== active && !this.toggling.has(id);
    });
    if (pending.length === 0) {
      // Re-render so UI checkboxes snap back to the real state.
      this._onDidChange.fire();
      return;
    }
    for (const id of pending) {
      this.toggling.add(id);
    }
    this._onDidChange.fire();

    const failures: string[] = [];
    await Promise.all(
      pending.map(async (id) => {
        try {
          await this.connection.client.setConnectionActive(id, active);
          const c = this.connections.find((x) => x.id === id);
          if (c) {
            c.isActive = active;
          }
          this.log(`Quota: account ${id} ${active ? 'enabled' : 'disabled'}`);
        } catch (error) {
          this.connection.reportError(error);
          failures.push(errorMessage(error));
        } finally {
          this.toggling.delete(id);
          this._onDidChange.fire();
        }
      })
    );

    if (failures.length > 0) {
      void vscode.window.showErrorMessage(`9Router: failed to update ${failures.length} account(s). ${failures[0]}`);
    }
    if (active) {
      await this.fetchMany(pending, false);
    }
  }

  private async fetchMany(ids: string[], force: boolean): Promise<void> {
    for (const id of ids) {
      this.setQuota(id, { ...this.quotaFor(id), status: 'loading' });
    }
    this._onDidChange.fire();
    const queue = [...ids];
    const workers = Array.from({ length: Math.min(MAX_CONCURRENT_FETCHES, queue.length) }, async () => {
      for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
        await this.fetchOne(id, force);
      }
    });
    await Promise.all(workers);
  }

  private async fetchOne(id: string, force: boolean): Promise<void> {
    const c = this.connections.find((x) => x.id === id);
    if (!c) {
      return;
    }
    this.setQuota(id, { ...this.quotaFor(id), status: 'loading' });
    this._onDidChange.fire();
    try {
      const body = await this.connection.client.getConnectionUsage(id, force);
      this.setQuota(id, parseUsageResponse(c.provider, body));
    } catch (error) {
      this.connection.reportError(error);
      this.setQuota(id, { ...this.quotaFor(id), status: 'error', error: errorMessage(error), fetchedAt: Date.now() });
    }
    this._onDidChange.fire();
  }

  private quotaFor(id: string): AccountQuota {
    return this.quotas.get(id) ?? { status: 'idle', rows: [] };
  }

  private setQuota(id: string, quota: AccountQuota): void {
    this.quotas.set(id, quota);
  }

  private autoRefreshSeconds(): number {
    return vscode.workspace.getConfiguration(QUOTA_SECTION).get<number>('autoRefreshInterval', 300);
  }

  private includeInactive(): boolean {
    return vscode.workspace.getConfiguration(QUOTA_SECTION).get<boolean>('fetchInactiveAccounts', false);
  }

  private scheduleAuto(): void {
    if (this.autoTimer) {
      clearInterval(this.autoTimer);
      this.autoTimer = undefined;
    }
    const seconds = this.autoRefreshSeconds();
    if (this.watchers > 0 && seconds > 0) {
      this.autoTimer = setInterval(() => {
        if (this.connection.isConnected() && !this.loadingList) {
          void this.refreshAll(false);
        }
      }, Math.max(30, seconds) * 1000);
    }
  }

  public dispose(): void {
    if (this.autoTimer) {
      clearInterval(this.autoTimer);
    }
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
