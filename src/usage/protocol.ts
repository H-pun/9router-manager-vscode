/**
 * Usage view (topology graph / activity chart / recent requests) messages.
 * Free of `vscode` imports — shared with webview-ui.
 */
import type { ActiveRequest, RecentRequest, UsageChartPoint } from '../dashboard/types';

export interface TopologyProvider {
  provider: string;
  name: string;
  color: string;
  textIcon: string;
  iconUri?: string;
}

export type UsagePeriod = 'today' | '24h' | '7d' | '30d';

export interface UsageViewState {
  connection: 'connected' | 'connecting' | 'signedOut' | 'error';
  connectionMessage?: string;
  serverUrl?: string;
  live: boolean;
  providers: TopologyProvider[];
  activeRequests: ActiveRequest[];
  recentRequests: RecentRequest[];
  lastProvider: string;
  errorProvider: string;
  totals: { requests: number; promptTokens: number; completionTokens: number; cost: number };
  /** Icon URIs keyed by lower-case provider id (for recent requests). */
  iconMap: Record<string, string>;
}

export type UsageWebviewToHost =
  | { type: 'ready' }
  | { type: 'fetchChart'; period: UsagePeriod }
  | { type: 'signIn' }
  | { type: 'openSettings' }
  | { type: 'openDashboard' };

export type UsageHostToWebview =
  | { type: 'state'; state: UsageViewState }
  | { type: 'chart'; period: UsagePeriod; data: UsageChartPoint[]; error?: string };
