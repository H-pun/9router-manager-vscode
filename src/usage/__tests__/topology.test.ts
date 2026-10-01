import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTopologyProviders } from '../topology';

test('dedupes active LLM providers and appends free no-auth providers', () => {
  const list = buildTopologyProviders([
    { id: '1', provider: 'claude', isActive: true },
    { id: '2', provider: 'claude', isActive: true },
    { id: '3', provider: 'codex', isActive: false },
    { id: '4', provider: 'elevenlabs', isActive: true },
    { id: '5', provider: 'antigravity' },
  ]);
  const ids = list.map((p) => p.provider);
  assert.deepEqual(ids.slice(0, 2), ['claude', 'antigravity']);
  assert.ok(!ids.includes('codex'));
  assert.ok(!ids.includes('elevenlabs'));
  assert.ok(ids.includes('opencode'));
  assert.equal(list[0]!.name, 'Claude Code');
  assert.match(list[0]!.color, /^#/);
});
