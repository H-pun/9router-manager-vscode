/**
 * Usage sidebar — tabs ported from the 9router-vscode monitor:
 * Graph (React Flow topology), Activity (Recharts), Recent Requests.
 */
import { useEffect, useState } from 'react';
import type { RecentRequest } from '../../../src/dashboard/types';
import type { UsageHostToWebview, UsageViewState } from '../../../src/usage/protocol';
import { post } from '../vscode';
import { ActivityChart } from './ActivityChart';
import { TopologyGraph } from './TopologyGraph';
import './usage.css';

type Tab = 'graph' | 'activity' | 'logs';
const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'graph', label: 'Graph' },
  { id: 'activity', label: 'Activity' },
  { id: 'logs', label: 'Recent Requests' },
];

export function UsageApp() {
  const [state, setState] = useState<UsageViewState | undefined>();
  const [tab, setTab] = useState<Tab>('graph');
  const [lastSeen, setLastSeen] = useState<{ provider: string; until: number } | undefined>();

  useEffect(() => {
    const onMessage = (event: MessageEvent<UsageHostToWebview>) => {
      if (event.data?.type === 'state') {
        setState(event.data.state);
      }
    };
    window.addEventListener('message', onMessage);
    post({ type: 'ready' });
    return () => window.removeEventListener('message', onMessage);
  }, []);

  // Old monitor behaviour: when a request just finished, briefly light up its provider.
  const newest = state?.recentRequests[0];
  useEffect(() => {
    if (!newest) { return; }
    const age = Date.now() - new Date(newest.timestamp).getTime();
    if (age < 7000) {
      setLastSeen({ provider: newest.provider, until: Date.now() + (7000 - age) });
      const t = setTimeout(() => setLastSeen(undefined), 7000 - age);
      return () => clearTimeout(t);
    }
  }, [newest?.timestamp, newest?.provider]);

  // Re-fit React Flow / Recharts after tab switches.
  useEffect(() => {
    const t = setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
    return () => clearTimeout(t);
  }, [tab]);

  if (!state) {
    return <div className="usage-empty">Loading…</div>;
  }
  if (state.connection !== 'connected') {
    return (
      <div className="auth-banner">
        <div className="auth-title">
          <i className={`codicon codicon-${state.connection === 'error' ? 'plug' : 'lock'}`} style={{ color: `var(--${state.connection === 'error' ? 'red' : 'orange'})` }} />
          <span>{state.connection === 'error' ? 'Server Unreachable' : state.connection === 'connecting' ? 'Connecting…' : 'Authentication Required'}</span>
        </div>
        <div className="auth-desc">{state.connectionMessage || 'Sign in to access 9Router usage & topology.'}</div>
        <div className="auth-server-tag">{state.serverUrl || 'http://localhost:20128'}</div>
        {state.connection !== 'connecting' && (
          <button className="btn-primary" onClick={() => post({ type: 'signIn' })}>
            <i className="codicon codicon-sign-in" /> Sign In to 9Router
          </button>
        )}
      </div>
    );
  }

  const activeProviders = [
    ...state.activeRequests.map((r) => r.provider),
    ...(lastSeen && lastSeen.until > Date.now() && state.activeRequests.length === 0 ? [lastSeen.provider] : []),
  ];

  return (
    <div className="usage-root">
      <div className="tabs-header-strip" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={`vsc-tab-btn ${tab === t.id ? 'active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
        <span className={`live-dot ${state.live ? 'on' : ''}`} title={state.live ? 'Live (SSE connected)' : 'Reconnecting…'} />
      </div>
      <div className="tab-panels-wrapper">
        <div className={`vsc-tab-panel ${tab === 'graph' ? 'active' : ''}`}>
          <TopologyGraph
            providers={state.providers}
            activeProviders={activeProviders}
            lastProvider={state.lastProvider}
            errorProvider={state.errorProvider}
          />
        </div>
        <div className={`vsc-tab-panel ${tab === 'activity' ? 'active' : ''}`}>
          <ActivityChart active={tab === 'activity'} />
        </div>
        <div className={`vsc-tab-panel ${tab === 'logs' ? 'active' : ''}`}>
          <RecentRequests requests={state.recentRequests} iconMap={state.iconMap} />
        </div>
      </div>
    </div>
  );
}

function RecentRequests({ requests, iconMap }: { requests: RecentRequest[]; iconMap: Record<string, string> }) {
  const [, force] = useState(0);
  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 15_000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="tab-content-table">
      <table>
        <thead>
          <tr>
            <th>Model</th>
            <th>In / Out</th>
            <th style={{ textAlign: 'right' }}>When</th>
          </tr>
        </thead>
        <tbody>
          {requests.length === 0 ? (
            <tr>
              <td colSpan={3} className="empty-state">No requests recorded yet</td>
            </tr>
          ) : (
            requests.map((r, i) => {
              const icon = iconMap[(r.provider || '').toLowerCase()];
              return (
                <tr key={`${r.timestamp}-${i}`} className={r.status && r.status !== 'ok' ? 'failed' : ''}>
                  <td>
                    <div className="model-cell" title={`${r.model} (${r.provider})`}>
                      {icon ? <img src={icon} className="model-icon" alt="" /> : <span className="codicon codicon-symbol-misc" />}
                      <span>{r.model || 'Unknown'}</span>
                    </div>
                  </td>
                  <td>
                    <span className="tokens-badge">
                      {fmt(r.promptTokens)} <span className="muted">/</span> {fmt(r.completionTokens)}
                    </span>
                  </td>
                  <td className="time-cell">{timeAgo(r.timestamp)}</td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

function fmt(n: number): string {
  if (!n) { return '0'; }
  if (n >= 1e6) { return `${(n / 1e6).toFixed(1)}M`; }
  if (n >= 1e3) { return `${(n / 1e3).toFixed(1)}K`; }
  return String(n);
}

function timeAgo(ts: string): string {
  if (!ts) { return ''; }
  const s = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 5) { return 'just now'; }
  if (s < 60) { return `${s}s ago`; }
  if (s < 3600) { return `${Math.floor(s / 60)}m ago`; }
  if (s < 86400) { return `${Math.floor(s / 3600)}h ago`; }
  return `${Math.floor(s / 86400)}d ago`;
}
