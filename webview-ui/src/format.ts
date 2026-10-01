/** Ported from the 9router-vscode monitor design. */

export type Tone = 'green' | 'orange' | 'red';

/** <20% red, <50% orange, else green (same thresholds as the old monitor). */
export function toneFor(pct: number): Tone {
  if (pct < 20) {
    return 'red';
  }
  if (pct < 50) {
    return 'orange';
  }
  return 'green';
}

export function statusIcon(tone: Tone): string {
  return tone === 'red' ? 'error' : tone === 'orange' ? 'warning' : 'pass-filled';
}

/** "in 2h 5m" / "in 3d 4h" / "Rolling" when no reset time. */
export function formatCountdown(resetAt: string | undefined, now: number): string {
  if (!resetAt) {
    return 'Rolling';
  }
  const diff = new Date(resetAt).getTime() - now;
  if (!Number.isFinite(diff)) {
    return 'Rolling';
  }
  if (diff <= 0) {
    return 'in 0m';
  }
  const days = Math.floor(diff / 86_400_000);
  const hours = Math.floor((diff % 86_400_000) / 3_600_000);
  const mins = Math.floor((diff % 3_600_000) / 60_000);
  if (days > 0) {
    return `in ${days}d ${hours}h`;
  }
  if (hours > 0) {
    return `in ${hours}h ${mins}m`;
  }
  return `in ${mins}m`;
}

export function formatCount(n: number): string {
  if (Math.abs(n) >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(1)}M`;
  }
  if (Math.abs(n) >= 10_000) {
    return `${(n / 1000).toFixed(1)}k`;
  }
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}
