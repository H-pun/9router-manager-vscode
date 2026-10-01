/** Shapes returned by the 9Router dashboard API (`/api/*`). */

export interface ApiKey {
  id: string;
  key: string;
  name: string;
  machineId?: string;
  isActive: boolean;
  createdAt?: string;
}

/** Sanitized provider connection (account) from `/api/providers/client`. */
export interface ProviderConnection {
  id: string;
  provider: string;
  authType?: string;
  name?: string;
  email?: string;
  displayName?: string;
  priority?: number;
  isActive?: boolean;
  testStatus?: string;
  lastError?: string | null;
  lastErrorAt?: string | null;
}

export interface ProvidersClientResponse {
  connections: ProviderConnection[];
  providerOptions?: string[];
  pagination?: { page: number; pageSize: number; total: number; totalPages: number };
}

export interface UsageChartPoint {
  label: string;
  tokens: number;
  cost: number;
  requests?: number;
}

export interface ActiveRequest {
  model: string;
  provider: string;
  account?: string;
  count?: number;
}

export interface RecentRequest {
  timestamp: string;
  model: string;
  provider: string;
  promptTokens: number;
  completionTokens: number;
  cachedTokens?: number;
  status?: string;
}

/** Payload of `/api/usage/stats` and each `/api/usage/stream` event (subset). */
export interface UsageStats {
  totalRequests?: number;
  totalPromptTokens?: number;
  totalCompletionTokens?: number;
  totalCachedTokens?: number;
  totalCost?: number;
  activeRequests?: ActiveRequest[];
  recentRequests?: RecentRequest[];
  errorProvider?: string;
  [key: string]: unknown;
}

export interface AuthStatus {
  requireLogin: boolean;
  authMode?: string;
  hasPassword?: boolean;
  authenticated: boolean;
  displayName?: string;
  loginMethod?: string;
}

export interface VersionInfo {
  currentVersion: string;
  latestVersion?: string;
  hasUpdate?: boolean;
}

/**
 * Subset of server settings the extension reads/writes. The server returns
 * many more fields; unknown ones are preserved as-is.
 */
export interface ServerSettings {
  rtkEnabled?: boolean;
  cavemanEnabled?: boolean;
  cavemanLevel?: string;
  ponytailEnabled?: boolean;
  ponytailLevel?: string;
  headroomEnabled?: boolean;
  headroomUrl?: string;
  pxpipeEnabled?: boolean;
  requireLogin?: boolean;
  requireApiKey?: boolean;
  [key: string]: unknown;
}

export type ConnectionState =
  | { kind: 'signedOut' }
  | { kind: 'connecting' }
  | { kind: 'connected'; serverUrl: string; version?: string }
  | { kind: 'error'; message: string };
