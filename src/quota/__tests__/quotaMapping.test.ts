import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  accountLabel,
  buildQuotaRows,
  groupConnections,
  hiddenKeys,
  lowestRemaining,
  normalizeQuotaRow,
  parseUsageResponse,
  providerDisplayName,
  updateVisibility,
} from '../quotaMapping';

const ag = (pct: number, resetAt = '2030-01-01T00:00:00Z', displayName?: string) => ({
  used: 100 - pct, total: 100, remainingPercentage: pct, resetAt, displayName,
});

test('antigravity: per-model rows collapse into family summaries (like the dashboard)', () => {
  const rows = buildQuotaRows('antigravity', {
    'gemini-3.6-flash-high': ag(80),
    'gemini-3.1-pro-low': ag(40),
    'gemini-3.1-flash-image': ag(90, undefined, 'Gemini Image'),
    'claude-opus-4-6-thinking': ag(60),
    'claude-sonnet-4-6': ag(20),
    'gpt-oss-120b-medium': ag(70, undefined, 'GPT-OSS 120B'),
  });
  assert.deepEqual(
    rows.map((r) => [r.key, r.name, r.remainingPercent]),
    [
      ['gemini', 'Gemini (Flash / Pro)', 40],
      ['claude', 'Claude (Sonnet / Opus)', 20],
      ['gemini-3.1-flash-image', 'Gemini Image', 90],
      ['gpt-oss-120b-medium', 'GPT-OSS 120B', 70],
    ]
  );
});

test('antigravity: summary keys win and hide others; exhausted duplicate of weekly is dropped', () => {
  const rows = buildQuotaRows('antigravity', {
    gemini_weekly: ag(0, '2030-01-07T00:00:00Z', 'Gemini Weekly'),
    'gemini-3.6-flash-high': ag(0, '2030-01-07T00:00:00Z'),
    claude_gpt_session: ag(50, undefined, 'Claude/GPT 5h'),
    claude_gpt_weekly: ag(30, undefined, 'Claude/GPT Weekly'),
    'claude-sonnet-4-6': ag(10),
    'gpt-oss-120b-medium': ag(70),
  });
  assert.deepEqual(rows.map((r) => r.key), ['gemini_weekly', 'claude_gpt_session', 'claude_gpt_weekly']);
});

test('claude rows use dashboard order; qoder drops empty organization', () => {
  const claude = buildQuotaRows('claude', {
    'weekly (7d)': { used: 1, total: 100 },
    'weekly opus (7d)': { used: 1, total: 100 },
    'session (5h)': { used: 1, total: 100 },
  });
  assert.deepEqual(claude.map((r) => r.key), ['session (5h)', 'weekly (7d)', 'weekly opus (7d)']);
  const qoder = buildQuotaRows('qoder', { user: { used: 1, total: 10 }, organization: { used: 0, total: 0 } });
  assert.deepEqual(qoder.map((r) => r.name), ['Personal']);
});

test('quota visibility hide/show mirrors dashboard', () => {
  let v = updateVisibility({}, 'antigravity', 'gemini-3.1-pro-low', true);
  v = updateVisibility(v, 'antigravity', 'gemini', true);
  assert.deepEqual([...hiddenKeys('antigravity', v)], ['gemini']);
  v = updateVisibility(v, 'antigravity', 'gemini', false);
  assert.equal(hiddenKeys('antigravity', v).size, 0);
  assert.equal(hiddenKeys('claude', v).size, 0);
});

test('claude: uses remainingPercentage', () => {
  const q = parseUsageResponse('claude', {
    plan: 'Claude Code',
    quotas: { 'session (5h)': { used: 87, total: 100, remaining: 13, remainingPercentage: 13, resetAt: '2030-01-01T00:00:00Z' } },
  });
  assert.equal(q.status, 'ok');
  assert.equal(q.plan, 'Claude Code');
  assert.deepEqual(q.rows[0], {
    key: 'session (5h)', name: 'session (5h)', used: 87, total: 100, remainingPercent: 13, unlimited: false, resetAt: '2030-01-01T00:00:00Z',
  });
});

test('github: remaining is a count, percent derived from used/total', () => {
  const row = normalizeQuotaRow('github', 'premium_interactions', { used: 75, total: 300, remaining: 225 });
  assert.equal(row?.remainingPercent, 75);
  const unlimited = normalizeQuotaRow('github', 'chat', { used: 0, total: 0, unlimited: true });
  assert.equal(unlimited?.remainingPercent, 100);
  assert.equal(unlimited?.unlimited, true);
});

test('codex: friendly names', () => {
  const q = parseUsageResponse('codex', { quotas: { session: { used: 40, total: 100, remaining: 60 }, weekly: { used: 10, total: 100 } } });
  assert.deepEqual(q.rows.map((r) => [r.name, r.remainingPercent]), [['5h', 60], ['Weekly', 90]]);
  assert.equal(lowestRemaining(q), 60);
});

test('soft messages and errors', () => {
  assert.equal(parseUsageResponse('x', { message: 'Usage not available for this connection' }).status, 'unsupported');
  const soft = parseUsageResponse('claude', { message: 'Claude connected. Usage API requires admin permissions.' });
  assert.equal(soft.status, 'ok');
  assert.match(soft.message ?? '', /admin/);
  const err = parseUsageResponse('claude', { error: 'Credential refresh failed' });
  assert.equal(err.status, 'error');
  assert.equal(parseUsageResponse('claude', undefined).status, 'error');
});

test('groupConnections groups by provider in order', () => {
  const groups = groupConnections(
    [
      { id: 'a1', provider: 'claude', name: 'work', isActive: true },
      { id: 'b1', provider: 'codex', email: 'me@x.io', isActive: false },
      { id: 'a2', provider: 'claude', isActive: true },
    ],
    () => ({ status: 'idle', rows: [] })
  );
  assert.deepEqual(groups.map((g) => [g.provider, g.displayName, g.accounts.length]), [
    ['claude', 'Claude Code', 2],
    ['codex', 'OpenAI Codex', 1],
  ]);
  assert.equal(groups[1]!.accounts[0]!.name, 'me@x.io');
  assert.equal(groups[1]!.accounts[0]!.isActive, false);
  assert.equal(groups[0]!.accounts[1]!.name, 'Claude Code a2');
});

test('providerDisplayName falls back to title case', () => {
  assert.equal(providerDisplayName('some-new_provider'), 'Some New Provider');
  assert.equal(accountLabel({ id: 'abcdef123', provider: 'kiro', name: '  ' }), 'Kiro abcdef');
});
