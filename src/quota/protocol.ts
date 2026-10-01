/**
 * Quota Tracker view-model types. Kept free of `vscode` / Node imports so it
 * can be shared with a future webview (webview-ui/) and unit tests.
 */

export interface QuotaRow {
  /** Visibility key, same as the dashboard's `modelKey || name`. */
  key: string;
  name: string;
  used: number;
  total: number;
  /** Remaining percentage 0-100, or undefined when unknown. */
  remainingPercent?: number;
  unlimited: boolean;
  resetAt?: string;
}

export type QuotaStatus = 'idle' | 'loading' | 'ok' | 'error' | 'unsupported';

export interface AccountQuota {
  status: QuotaStatus;
  plan?: string;
  /** Soft message from the provider (e.g. "Usage API requires admin"). */
  message?: string;
  error?: string;
  /** Rows the user can see (dashboard `quotaVisibility` applied). */
  rows: QuotaRow[];
  /** Rows hidden via the dashboard's quota visibility setting. */
  hiddenRows?: QuotaRow[];
  fetchedAt?: number;
}

export interface QuotaAccount {
  id: string;
  provider: string;
  name: string;
  authType?: string;
  isActive: boolean;
  priority?: number;
  testStatus?: string;
  lastError?: string;
  quota: AccountQuota;
  /** True while an on/off toggle is in flight. */
  toggling?: boolean;
  /** True while a connection test is in flight. */
  testing?: boolean;
}

export interface QuotaProviderGroup {
  provider: string;
  displayName: string;
  /** Webview URI of the provider logo, when bundled. */
  iconUri?: string;
  accounts: QuotaAccount[];
}

export type QuotaFilter = 'active' | 'all' | 'inactive';

export interface QuotaViewState {
  connection: 'connected' | 'connecting' | 'signedOut' | 'error';
  connectionMessage?: string;
  serverUrl?: string;
  loadingList: boolean;
  listError?: string;
  groups: QuotaProviderGroup[];
  lastRefreshAt?: number;
  autoRefreshSeconds: number;
  filter: QuotaFilter;
}

export type WebviewToHost =
  | { type: 'ready' }
  | { type: 'refreshAll' }
  | { type: 'refreshAccount'; id: string }
  | { type: 'toggleAccount'; id: string; active: boolean }
  | { type: 'toggleProvider'; provider: string; active: boolean }
  | { type: 'testAccount'; id: string }
  | { type: 'hideQuota'; provider: string; key: string }
  | { type: 'showQuota'; provider: string; key: string }
  | { type: 'signIn' }
  | { type: 'openSettings' }
  | { type: 'openDashboard' };

export type HostToWebview = { type: 'state'; state: QuotaViewState };
