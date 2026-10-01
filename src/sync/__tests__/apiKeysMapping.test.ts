import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLabels, diffApiKeys, isEmptyDiff, settingsEqual, toSettingValue } from '../apiKeysMapping';
import { ApiKey } from '../../dashboard/types';

const k = (id: string, name: string, isActive = true): ApiKey => ({ id, name, key: `sk-${id}`, isActive });

test('buildLabels disambiguates duplicate names', () => {
  const labels = buildLabels([k('aaaaaaaa1', 'dev'), k('bbbbbbbb2', 'dev'), k('c3', 'prod'), k('d4', '')]);
  assert.deepEqual([...labels.keys()], ['dev [aaaaaaaa]', 'dev [bbbbbbbb]', 'prod', 'd4']);
});

test('toSettingValue maps labels to active flags', () => {
  assert.deepEqual(toSettingValue(buildLabels([k('1', 'a'), k('2', 'b', false)])), { a: true, b: false });
});

test('diffApiKeys detects create, remove and toggle', () => {
  const labels = buildLabels([k('1', 'a'), k('2', 'b'), k('3', 'c', false)]);
  const diff = diffApiKeys({ a: true, b: false, new: true, ' ': true }, labels);
  assert.deepEqual(diff.create, [{ name: 'new', active: true }]);
  assert.deepEqual(diff.toggle.map((t) => [t.label, t.active]), [['b', false]]);
  assert.deepEqual(diff.remove.map((r) => r.label), ['c']);
});

test('diffApiKeys is empty when in sync', () => {
  const labels = buildLabels([k('1', 'a'), k('2', 'b', false)]);
  assert.ok(isEmptyDiff(diffApiKeys(toSettingValue(labels), labels)));
});

test('settingsEqual compares entries', () => {
  assert.ok(settingsEqual({ a: true }, { a: true }));
  assert.ok(!settingsEqual({ a: true }, { a: false }));
  assert.ok(!settingsEqual({ a: true }, { a: true, b: true }));
});
