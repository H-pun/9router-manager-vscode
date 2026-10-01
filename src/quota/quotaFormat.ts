/** Pure formatting helpers for quota display. No `vscode` imports. */

export type QuotaLevel = 'good' | 'warn' | 'bad' | 'unknown';

/** Same thresholds as the 9Router dashboard: >70 green, 30-70 yellow, <30 red. */
export function levelFor(pct: number | undefined): QuotaLevel {
  if (pct === undefined) {
    return 'unknown';
  }
  if (pct > 70) {
    return 'good';
  }
  if (pct >= 30) {
    return 'warn';
  }
  return 'bad';
}

/** "2h 5m", "3d 4h", "12m"; undefined when missing or in the past. */
export function formatResetIn(resetAt: string | undefined, now: number): string | undefined {
  if (!resetAt) {
    return undefined;
  }
  const diff = new Date(resetAt).getTime() - now;
  if (!Number.isFinite(diff) || diff <= 0) {
    return undefined;
  }
  const minutes = Math.ceil(diff / 60000);
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ${minutes % 60}m`;
  }
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

/** 10-cell text progress bar of the remaining percentage. */
export function quotaBar(pct: number | undefined, cells = 10): string {
  if (pct === undefined) {
    return '▱'.repeat(cells);
  }
  const filled = Math.max(0, Math.min(cells, Math.round((pct / 100) * cells)));
  return '▰'.repeat(filled) + '▱'.repeat(cells - filled);
}
