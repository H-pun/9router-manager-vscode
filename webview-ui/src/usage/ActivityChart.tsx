/** Tokens / cost area chart — ported from the 9router-vscode monitor. */
import { useEffect, useState } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { UsageChartPoint } from '../../../src/dashboard/types';
import type { UsageHostToWebview, UsagePeriod } from '../../../src/usage/protocol';
import { post } from '../vscode';

const PERIODS: UsagePeriod[] = ['today', '24h', '7d', '30d'];

const fmtTokens = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(n || 0));
const fmtCost = (n: number) => `$${(n || 0).toFixed(4)}`;

export function ActivityChart({ active }: { active: boolean }) {
  const [period, setPeriod] = useState<UsagePeriod>('today');
  const [mode, setMode] = useState<'tokens' | 'cost'>('tokens');
  const [data, setData] = useState<UsageChartPoint[] | undefined>();
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    const handler = (event: MessageEvent<UsageHostToWebview>) => {
      const msg = event.data;
      if (msg?.type === 'chart' && msg.period === period) {
        setData(msg.data);
        setError(msg.error);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [period]);

  // Fetch when the tab becomes visible or the period changes.
  useEffect(() => {
    if (active) {
      setData(undefined);
      post({ type: 'fetchChart', period });
    }
  }, [active, period]);

  const hasData = !!data && data.some((d) => d.tokens > 0 || d.cost > 0);

  return (
    <div className="chart-wrap">
      <div className="chart-controls">
        <div className="seg">
          {(['tokens', 'cost'] as const).map((m) => (
            <button key={m} type="button" className={mode === m ? 'on' : ''} onClick={() => setMode(m)}>
              {m === 'tokens' ? 'Tokens' : 'Cost'}
            </button>
          ))}
        </div>
        <div className="seg">
          {PERIODS.map((p) => (
            <button key={p} type="button" className={`upper ${period === p ? 'on' : ''}`} onClick={() => setPeriod(p)}>
              {p}
            </button>
          ))}
        </div>
      </div>
      <div className="chart-canvas">
        {data === undefined ? (
          <div className="usage-empty">Loading chart data…</div>
        ) : error ? (
          <div className="usage-empty error">{error}</div>
        ) : !hasData ? (
          <div className="usage-empty italic">No activity recorded for this period</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 8, right: 6, left: -22, bottom: 4 }}>
              <defs>
                <linearGradient id="gradTokens" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#6366f1" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gradCost" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.12} stroke="var(--vscode-tree-indentGuidesStroke, #888)" />
              <XAxis dataKey="label" tick={{ fontSize: 9.5, fill: 'var(--vscode-descriptionForeground, #888)' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 9.5, fill: 'var(--vscode-descriptionForeground, #888)' }} tickLine={false} axisLine={false} tickFormatter={mode === 'tokens' ? fmtTokens : fmtCost} width={46} />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'var(--vscode-menu-background, #252526)',
                  borderColor: 'var(--vscode-menu-border, rgba(128,128,128,0.3))',
                  borderRadius: 6,
                  fontSize: 11,
                  color: 'var(--vscode-sideBar-foreground, #fff)',
                  padding: '4px 8px',
                }}
                formatter={(value) => (mode === 'tokens' ? [fmtTokens(Number(value)), 'Tokens'] : [fmtCost(Number(value)), 'Cost'])}
              />
              {mode === 'tokens' ? (
                <Area type="monotone" dataKey="tokens" stroke="#818cf8" strokeWidth={2} fill="url(#gradTokens)" dot={false} activeDot={{ r: 4, fill: '#818cf8' }} />
              ) : (
                <Area type="monotone" dataKey="cost" stroke="#fbbf24" strokeWidth={2} fill="url(#gradCost)" dot={false} activeDot={{ r: 4, fill: '#fbbf24' }} />
              )}
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
