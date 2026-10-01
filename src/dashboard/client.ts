/**
 * HTTP client for the 9Router dashboard API (`/api/*`), authenticated with
 * the `auth_token` session cookie obtained from `POST /api/auth/login`.
 *
 * Deliberately free of `vscode` imports so it can be unit-tested with a fake
 * `fetch` and an in-memory credential store.
 */
import { DashboardError } from './errors';
import { AUTH_COOKIE_NAME, bodyErrorText, extractAuthCookie, getSetCookies } from './http';
import {
  ApiKey,
  AuthStatus,
  ProviderConnection,
  ProvidersClientResponse,
  ServerSettings,
  UsageChartPoint,
  UsageStats,
  VersionInfo,
} from './types';

/** Persists the session token and password per server URL. */
export interface CredentialStore {
  getToken(serverUrl: string): Promise<string | undefined>;
  setToken(serverUrl: string, token: string | undefined): Promise<void>;
  getPassword(serverUrl: string): Promise<string | undefined>;
  setPassword(serverUrl: string, password: string | undefined): Promise<void>;
}

export type FetchFn = typeof fetch;

export interface DashboardClientOptions {
  store: CredentialStore;
  fetch?: FetchFn;
  timeoutMs?: () => number;
  log?: (message: string) => void;
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export class DashboardClient {
  private serverUrl: string | undefined;
  private readonly fetchFn: FetchFn;
  private reloginInFlight: Promise<boolean> | undefined;

  constructor(private readonly options: DashboardClientOptions) {
    this.fetchFn = options.fetch ?? fetch;
  }

  public setServerUrl(serverUrl: string | undefined): void {
    this.serverUrl = serverUrl;
  }

  public getServerUrl(): string | undefined {
    return this.serverUrl;
  }

  // ── Auth ────────────────────────────────────────────────────────────────

  /**
   * Sign in with the dashboard password. On success the session cookie and
   * password are persisted (the password enables transparent re-login when
   * the 24h JWT expires).
   */
  public async login(password: string, remember = true): Promise<void> {
    const serverUrl = this.requireServerUrl();
    const res = await this.rawFetch('POST', '/api/auth/login', { password });
    const body = await readBody(res);

    if (res.ok) {
      const token = extractAuthCookie(getSetCookies(res.headers));
      if (!token) {
        throw new DashboardError(
          'Login succeeded but the server did not return a session cookie.',
          'http',
          res.status
        );
      }
      await this.options.store.setToken(serverUrl, token);
      await this.options.store.setPassword(serverUrl, remember ? password : undefined);
      this.log(`Signed in to ${serverUrl}`);
      return;
    }

    const message = bodyErrorText(body, `Login failed (HTTP ${res.status})`);
    const obj = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    if (res.status === 401) {
      throw new DashboardError(message, 'invalidPassword', 401);
    }
    if (res.status === 429) {
      const retryAfter =
        typeof obj.retryAfter === 'number' ? obj.retryAfter : Number(res.headers.get('retry-after')) || undefined;
      throw new DashboardError(message, 'rateLimited', 429, retryAfter);
    }
    if (res.status === 403) {
      if (obj.mustChangePassword === true) {
        throw new DashboardError(message, 'mustChangePassword', 403);
      }
      if (/password login is disabled/i.test(message)) {
        throw new DashboardError(message, 'passwordLoginDisabled', 403);
      }
      throw new DashboardError(message, 'forbidden', 403);
    }
    throw new DashboardError(message, 'http', res.status);
  }

  /** Clear the server session (best effort) and forget stored credentials. */
  public async logout(forgetPassword = true): Promise<void> {
    const serverUrl = this.serverUrl;
    if (!serverUrl) {
      return;
    }
    const token = await this.options.store.getToken(serverUrl);
    if (token) {
      try {
        await this.rawFetch('POST', '/api/auth/logout', undefined, token);
      } catch (error) {
        this.log(`Logout request failed (ignored): ${String(error)}`);
      }
    }
    await this.options.store.setToken(serverUrl, undefined);
    if (forgetPassword) {
      await this.options.store.setPassword(serverUrl, undefined);
    }
  }

  public async hasStoredPassword(): Promise<boolean> {
    return !!this.serverUrl && !!(await this.options.store.getPassword(this.serverUrl));
  }

  /**
   * Re-login using the stored password. Concurrent callers share one attempt.
   * Returns false when no password is stored or login fails.
   */
  public async relogin(): Promise<boolean> {
    if (!this.reloginInFlight) {
      this.reloginInFlight = (async () => {
        const serverUrl = this.serverUrl;
        if (!serverUrl) {
          return false;
        }
        const password = await this.options.store.getPassword(serverUrl);
        if (!password) {
          return false;
        }
        try {
          await this.login(password);
          return true;
        } catch (error) {
          this.log(`Automatic re-login failed: ${String(error)}`);
          return false;
        }
      })().finally(() => {
        this.reloginInFlight = undefined;
      });
    }
    return this.reloginInFlight;
  }

  // ── Public endpoints ─────────────────────────────────────────────────────

  public async health(): Promise<boolean> {
    const res = await this.rawFetch('GET', '/api/health');
    return res.ok;
  }

  public async version(): Promise<VersionInfo | undefined> {
    const res = await this.rawFetch('GET', '/api/version');
    if (!res.ok) {
      return undefined;
    }
    return (await readBody(res)) as VersionInfo;
  }

  public async authStatus(): Promise<AuthStatus> {
    return this.request<AuthStatus>('GET', '/api/auth/status');
  }

  // ── API keys ─────────────────────────────────────────────────────────────

  public async listKeys(): Promise<ApiKey[]> {
    const body = await this.request<{ keys?: ApiKey[] }>('GET', '/api/keys');
    return Array.isArray(body.keys) ? body.keys : [];
  }

  public async createKey(name: string): Promise<ApiKey> {
    const body = await this.request<Partial<ApiKey>>('POST', '/api/keys', { name });
    return {
      id: String(body.id ?? ''),
      key: String(body.key ?? ''),
      name: String(body.name ?? name),
      machineId: body.machineId,
      isActive: body.isActive ?? true,
    };
  }

  public async setKeyActive(id: string, isActive: boolean): Promise<ApiKey | undefined> {
    const body = await this.request<{ key?: ApiKey }>(
      'PUT',
      `/api/keys/${encodeURIComponent(id)}`,
      { isActive }
    );
    return body.key;
  }

  public async deleteKey(id: string): Promise<void> {
    await this.request('DELETE', `/api/keys/${encodeURIComponent(id)}`);
  }

  // ── Provider connections & quota ─────────────────────────────────────────

  /** Quota-eligible provider connections (all pages). */
  public async listQuotaConnections(): Promise<ProviderConnection[]> {
    const all: ProviderConnection[] = [];
    const pageSize = 500;
    for (let page = 1; page <= 20; page++) {
      const body = await this.request<ProvidersClientResponse>(
        'GET',
        `/api/providers/client?provider=all&accountStatus=all&sort=provider&page=${page}&pageSize=${pageSize}`
      );
      const connections = Array.isArray(body.connections) ? body.connections : [];
      all.push(...connections);
      const totalPages = body.pagination?.totalPages ?? 1;
      if (page >= totalPages || connections.length === 0) {
        break;
      }
    }
    return all;
  }

  /** `POST /api/providers/:id/test` → `{ valid, error? }`. */
  public async testConnection(id: string): Promise<{ valid: boolean; error?: string }> {
    const body = await this.request<{ valid?: boolean; error?: string }>(
      'POST',
      `/api/providers/${encodeURIComponent(id)}/test`
    );
    return { valid: body.valid === true, error: body.error ?? undefined };
  }

  public async setConnectionActive(id: string, isActive: boolean): Promise<void> {
    await this.request('PUT', `/api/providers/${encodeURIComponent(id)}`, { isActive });
  }

  /**
   * Raw quota for one connection. Errors reported by the server as JSON
   * (`{ error }`) are returned as the body rather than thrown so the caller
   * can display them per-account; auth/network failures still throw.
   */
  public async getConnectionUsage(id: string, force: boolean): Promise<unknown> {
    try {
      return await this.request('GET', `/api/usage/${encodeURIComponent(id)}${force ? '?force=1' : ''}`);
    } catch (error) {
      if (error instanceof DashboardError && error.code === 'http') {
        return { error: error.message.replace(/^GET \S+ failed: /, '') };
      }
      throw error;
    }
  }

  // ── Settings ─────────────────────────────────────────────────────────────

  public async getSettings(): Promise<ServerSettings> {
    return this.request<ServerSettings>('GET', '/api/settings');
  }

  public async patchSettings(patch: Partial<ServerSettings>): Promise<ServerSettings> {
    return this.request<ServerSettings>('PATCH', '/api/settings', patch);
  }

  // ── Usage (topology / chart) ─────────────────────────────────────────────

  /** `GET /api/usage/chart?period=` → `[{ label, tokens, cost, requests }]`. */
  public async getUsageChart(period: string): Promise<UsageChartPoint[]> {
    const body = await this.request<unknown>('GET', `/api/usage/chart?period=${encodeURIComponent(period)}`);
    return Array.isArray(body) ? (body as UsageChartPoint[]) : [];
  }

  /** `GET /api/usage/stats?period=` (same shape as the SSE payload). */
  public async getUsageStats(period: string): Promise<UsageStats> {
    return this.request<UsageStats>('GET', `/api/usage/stats?period=${encodeURIComponent(period)}`);
  }

  /** All provider connections (`GET /api/providers`, secrets stripped). */
  public async listAllConnections(): Promise<ProviderConnection[]> {
    const body = await this.request<{ connections?: ProviderConnection[] }>('GET', '/api/providers');
    return Array.isArray(body.connections) ? body.connections : [];
  }

  /**
   * Open the `GET /api/usage/stream` SSE response (authenticated, with one
   * transparent re-login on 401). Caller owns reading/cancelling the body.
   */
  public async openUsageStream(signal: AbortSignal): Promise<Response> {
    const serverUrl = this.requireServerUrl();
    const open = async () => {
      const token = await this.options.store.getToken(serverUrl);
      const headers: Record<string, string> = { Accept: 'text/event-stream', 'Cache-Control': 'no-cache' };
      if (token) {
        headers.Cookie = `${AUTH_COOKIE_NAME}=${token}`;
      }
      return this.fetchFn(`${serverUrl}/api/usage/stream`, { headers, signal, redirect: 'manual' });
    };
    let res = await open();
    if (res.status === 401) {
      await drain(res);
      if (await this.relogin()) {
        res = await open();
      }
    }
    if (res.status === 401) {
      await drain(res);
      throw new DashboardError('Not signed in to the 9Router dashboard.', 'unauthorized', 401);
    }
    if (!res.ok || !res.body) {
      await drain(res);
      throw new DashboardError(`Usage stream failed (HTTP ${res.status}).`, 'http', res.status);
    }
    return res;
  }

  // ── Core request ─────────────────────────────────────────────────────────

  /**
   * Authenticated JSON request. On 401 it re-logs in once with the stored
   * password and retries; otherwise throws `DashboardError('unauthorized')`.
   */
  public async request<T>(method: Method, path: string, body?: unknown): Promise<T> {
    const serverUrl = this.requireServerUrl();
    let token = await this.options.store.getToken(serverUrl);
    let res = await this.rawFetch(method, path, body, token);

    if (res.status === 401) {
      await drain(res);
      const ok = await this.relogin();
      if (ok) {
        token = await this.options.store.getToken(serverUrl);
        res = await this.rawFetch(method, path, body, token);
      }
      if (res.status === 401) {
        await drain(res);
        await this.options.store.setToken(serverUrl, undefined);
        throw new DashboardError('Not signed in to the 9Router dashboard.', 'unauthorized', 401);
      }
    }

    const data = await readBody(res);
    if (!res.ok) {
      const message = bodyErrorText(data, `HTTP ${res.status} ${res.statusText}`.trim());
      throw new DashboardError(
        `${method} ${path} failed: ${message}`,
        res.status === 403 ? 'forbidden' : 'http',
        res.status
      );
    }
    return data as T;
  }

  private async rawFetch(
    method: Method,
    path: string,
    body?: unknown,
    token?: string
  ): Promise<Response> {
    const serverUrl = this.requireServerUrl();
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    if (token) {
      headers.Cookie = `${AUTH_COOKIE_NAME}=${token}`;
    }

    const timeoutMs = this.options.timeoutMs?.() ?? 15000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await this.fetchFn(`${serverUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
        redirect: 'manual',
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new DashboardError(`Request to ${serverUrl} timed out after ${timeoutMs}ms.`, 'timeout');
      }
      const cause = (error as { cause?: { code?: string; message?: string } }).cause;
      const detail = cause?.code ?? cause?.message ?? (error instanceof Error ? error.message : String(error));
      throw new DashboardError(`Cannot reach 9Router at ${serverUrl} (${detail}).`, 'network');
    } finally {
      clearTimeout(timer);
    }
  }

  private requireServerUrl(): string {
    if (!this.serverUrl) {
      throw new DashboardError('9Router server URL is not configured or invalid.', 'notSignedIn');
    }
    return this.serverUrl;
  }

  private log(message: string): void {
    this.options.log?.(message);
  }
}

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) {
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function drain(res: Response): Promise<void> {
  try {
    await res.text();
  } catch {
    // ignore
  }
}
