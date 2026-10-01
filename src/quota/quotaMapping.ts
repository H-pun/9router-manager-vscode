/**
 * Normalize raw `/api/usage/:connectionId` responses into display rows.
 * Pure — no `vscode` imports.
 *
 * Provider handlers return `{ plan?, message?, quotas?: { [name]: {
 * used, total, remaining?, remainingPercentage?, resetAt?, unlimited? } } }`.
 * `remaining` is a count for some providers (GitHub) and a percentage for
 * others (Codex/Claude, where total is 100), so the percentage is derived
 * from `remainingPercentage` first, then used/total.
 */
import { AccountQuota, QuotaProviderGroup, QuotaRow } from './protocol';
import { ProviderConnection } from '../dashboard/types';

const PROVIDER_NAMES: Record<string, string> = {
  claude: 'Claude Code',
  codex: 'OpenAI Codex',
  github: 'GitHub Copilot',
  'gemini-cli': 'Gemini CLI',
  antigravity: 'Antigravity',
  kiro: 'Kiro',
  qoder: 'Qoder',
  'qoder-cn': 'Qoder CN',
  glm: 'GLM (Z.ai)',
  minimax: 'MiniMax',
  kimi: 'Kimi',
  deepseek: 'DeepSeek',
  groq: 'Groq',
  zed: 'Zed',
  'opencode-go': 'OpenCode Go',
  'opencode-zen': 'OpenCode Zen',
  'codebuddy-cn': 'CodeBuddy CN',
  'grok-cli': 'Grok CLI',
  'xiaomi-mimo': 'Xiaomi MiMo',
  commandcode: 'Command Code',
  ollama: 'Ollama',
  'vercel-ai-gateway': 'Vercel AI Gateway',
  iflow: 'iFlow',
};

const CODEX_NAMES: Record<string, string> = {
  session: '5h',
  weekly: 'Weekly',
  review_session: 'Review (5h)',
  review_weekly: 'Review (Weekly)',
  spark_session: 'Spark (5h)',
  spark_weekly: 'Spark (Weekly)',
};

export function providerDisplayName(provider: string): string {
  return (
    PROVIDER_NAMES[provider] ??
    provider
      .split(/[-_]/)
      .map((p) => (p ? p[0]!.toUpperCase() + p.slice(1) : p))
      .join(' ')
  );
}

function num(value: unknown): number | undefined {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
}

function clampPct(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function normalizeQuotaRow(provider: string, name: string, raw: unknown): QuotaRow | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined;
  }
  const q = raw as Record<string, unknown>;
  const used = num(q.used) ?? 0;
  const total = num(q.total) ?? 0;
  const unlimited = q.unlimited === true;
  const displayName =
    (typeof q.displayName === 'string' && q.displayName) ||
    (provider === 'codex' ? CODEX_NAMES[name] : undefined) ||
    name;

  let remainingPercent: number | undefined;
  const rp = num(q.remainingPercentage);
  if (unlimited) {
    remainingPercent = 100;
  } else if (rp !== undefined) {
    remainingPercent = clampPct(rp);
  } else if (total > 0) {
    remainingPercent = clampPct(((total - used) / total) * 100);
  }

  const resetAt = typeof q.resetAt === 'string' && q.resetAt ? q.resetAt : undefined;
  return { key: name, name: displayName, used, total, remainingPercent, unlimited, resetAt };
}

/**
 * Build display rows exactly like the 9Router dashboard's `parseQuotaData`
 * (ProviderLimits/utils.js): Antigravity is collapsed into family summary
 * rows, Qoder drops empty organization rows, Claude rows use a fixed order.
 */
export function buildQuotaRows(provider: string, quotas: Record<string, unknown>): QuotaRow[] {
  const p = provider.toLowerCase();
  if (p === 'antigravity') {
    return buildAntigravityRows(quotas);
  }
  const rows: QuotaRow[] = [];
  for (const [name, raw] of Object.entries(quotas)) {
    if ((p === 'qoder' || p === 'qoder-cn') && name === 'organization') {
      const total = num((raw as Record<string, unknown> | null)?.total) ?? 0;
      if (total === 0) {
        continue;
      }
    }
    const row = normalizeQuotaRow(provider, name, raw);
    if (!row) {
      continue;
    }
    if (p === 'qoder' || p === 'qoder-cn') {
      row.name = name === 'user' ? 'Personal' : name === 'organization' ? 'Organization' : row.name;
    }
    rows.push(row);
  }
  if (p === 'claude') {
    rows.sort((a, b) => (CLAUDE_ORDER[a.key] ?? 99) - (CLAUDE_ORDER[b.key] ?? 99));
  }
  return rows;
}

const CLAUDE_ORDER: Record<string, number> = {
  'session (5h)': 0,
  'weekly (7d)': 1,
  'weekly fable (7d)': 2,
  'weekly opus (7d)': 3,
  'weekly sonnet (7d)': 4,
};

const AG_WEEKLY = new Set(['gemini_weekly', 'claude_gpt_weekly']);
const AG_SESSION = new Set(['gemini_session', 'claude_gpt_session']);

function pctOf(raw: unknown): number {
  return num((raw as Record<string, unknown> | null)?.remainingPercentage) ?? 100;
}

function resetOf(raw: unknown): unknown {
  return (raw as Record<string, unknown> | null)?.resetAt;
}

/** Port of the dashboard's antigravity branch (family grouping). */
function buildAntigravityRows(quotas: Record<string, unknown>): QuotaRow[] {
  const entries = Object.entries(quotas);
  const summaryKeys = new Set([...AG_WEEKLY, ...AG_SESSION]);
  const gemini = entries.filter(([k]) => k.startsWith('gemini-') && !k.includes('image'));
  const claude = entries.filter(([k]) => k.startsWith('claude-'));
  const image = entries.filter(([k]) => k.includes('image'));
  const other = entries.filter(
    ([k]) => !k.startsWith('gemini-') && !k.startsWith('claude-') && !k.includes('image') && !summaryKeys.has(k)
  );
  const rows: QuotaRow[] = [];
  const push = (key: string, raw: unknown, name?: string) => {
    const row = normalizeQuotaRow('antigravity', key, raw);
    if (row) {
      if (name) {
        row.name = name;
      }
      row.key = key;
      rows.push(row);
    }
  };
  const lowest = (list: [string, unknown][]) =>
    list.reduce((min, cur) => (pctOf(cur[1]) < pctOf(min[1]) ? cur : min))[1];

  const family = (sessionKey: string, weeklyKey: string, models: [string, unknown][], anchor: string, label: string) => {
    if (quotas[sessionKey]) {
      push(sessionKey, quotas[sessionKey]);
    } else if (models.length > 0) {
      const rep = lowest(models);
      const weekly = quotas[weeklyKey];
      const duplicateOfWeekly = !!weekly && resetOf(rep) === resetOf(weekly) && pctOf(rep) === 0;
      if (!duplicateOfWeekly) {
        push(anchor, rep, label);
      }
    }
    if (quotas[weeklyKey]) {
      push(weeklyKey, quotas[weeklyKey]);
    }
  };

  family('gemini_session', 'gemini_weekly', gemini, 'gemini', 'Gemini (Flash / Pro)');
  family('claude_gpt_session', 'claude_gpt_weekly', claude, 'claude', 'Claude (Sonnet / Opus)');
  for (const [k, raw] of image) {
    push(k, raw);
  }
  if (!quotas.claude_gpt_weekly && !quotas.claude_gpt_session) {
    for (const [k, raw] of other) {
      push(k, raw);
    }
  }
  return rows;
}

/** Dashboard `quotaVisibility` shape: `{ [provider]: { hidden: string[] } }`. */
export type QuotaVisibility = Record<string, { hidden?: string[] } | undefined>;

export function hiddenKeys(provider: string, visibility: QuotaVisibility | undefined): Set<string> {
  const hidden = visibility?.[provider]?.hidden;
  return new Set(Array.isArray(hidden) ? hidden.map((k) => String(k).trim()) : []);
}

/**
 * Next visibility object after hiding/showing a row, mirroring the dashboard's
 * handleHideQuota/handleShowQuota (incl. Antigravity family cleanup).
 */
export function updateVisibility(
  visibility: QuotaVisibility,
  provider: string,
  key: string,
  hide: boolean
): QuotaVisibility {
  const current = visibility[provider] ?? {};
  const hidden = new Set(current.hidden ?? []);
  if (hide) {
    hidden.add(key);
  } else {
    hidden.delete(key);
  }
  if (provider === 'antigravity') {
    for (const k of [...hidden]) {
      if (key === 'gemini' && k.startsWith('gemini-') && !k.includes('image')) {
        hidden.delete(k);
      } else if (key === 'claude' && k.startsWith('claude-')) {
        hidden.delete(k);
      }
    }
  }
  return { ...visibility, [provider]: { ...current, hidden: [...hidden] } };
}

/** Parse a raw usage response body into an AccountQuota. */
export function parseUsageResponse(provider: string, body: unknown, now = Date.now()): AccountQuota {
  if (!body || typeof body !== 'object') {
    return { status: 'error', error: 'Empty usage response', rows: [], fetchedAt: now };
  }
  const data = body as Record<string, unknown>;
  const plan = typeof data.plan === 'string' && data.plan ? data.plan : undefined;
  const message = typeof data.message === 'string' && data.message ? data.message : undefined;

  if (typeof data.error === 'string' && data.error) {
    return { status: 'error', error: data.error, plan, rows: [], fetchedAt: now };
  }

  const rows: QuotaRow[] =
    data.quotas && typeof data.quotas === 'object'
      ? buildQuotaRows(provider, data.quotas as Record<string, unknown>)
      : [];

  if (rows.length === 0 && message && /not available for this connection/i.test(message)) {
    return { status: 'unsupported', message, rows, fetchedAt: now };
  }
  return { status: 'ok', plan, message, rows, fetchedAt: now };
}

/** Lowest remaining percentage across rows (for sorting / badges). */
export function lowestRemaining(quota: AccountQuota): number | undefined {
  let min: number | undefined;
  for (const row of quota.rows) {
    if (row.remainingPercent !== undefined && (min === undefined || row.remainingPercent < min)) {
      min = row.remainingPercent;
    }
  }
  return min;
}

/** Group connections by provider, preserving first-seen order. */
export function groupConnections(
  connections: readonly ProviderConnection[],
  quotaFor: (id: string) => AccountQuota
): QuotaProviderGroup[] {
  const groups = new Map<string, QuotaProviderGroup>();
  for (const c of connections) {
    let group = groups.get(c.provider);
    if (!group) {
      group = { provider: c.provider, displayName: providerDisplayName(c.provider), accounts: [] };
      groups.set(c.provider, group);
    }
    group.accounts.push({
      id: c.id,
      provider: c.provider,
      name: accountLabel(c),
      authType: c.authType,
      isActive: c.isActive !== false,
      priority: c.priority,
      testStatus: c.testStatus,
      lastError: c.lastError ?? undefined,
      quota: quotaFor(c.id),
    });
  }
  return [...groups.values()];
}

export function accountLabel(c: ProviderConnection): string {
  return (
    c.name?.trim() ||
    c.email?.trim() ||
    c.displayName?.trim() ||
    `${providerDisplayName(c.provider)} ${c.id.slice(0, 6)}`
  );
}
