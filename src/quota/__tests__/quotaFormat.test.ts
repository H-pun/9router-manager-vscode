import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatResetIn, levelFor, quotaBar } from '../quotaFormat';

test('levelFor thresholds', () => {
  assert.equal(levelFor(undefined), 'unknown');
  assert.equal(levelFor(71), 'good');
  assert.equal(levelFor(70), 'warn');
  assert.equal(levelFor(30), 'warn');
  assert.equal(levelFor(29), 'bad');
});

test('formatResetIn', () => {
  const now = Date.parse('2030-01-01T00:00:00Z');
  assert.equal(formatResetIn(undefined, now), undefined);
  assert.equal(formatResetIn('2029-12-31T23:00:00Z', now), undefined);
  assert.equal(formatResetIn('2030-01-01T00:12:00Z', now), '12m');
  assert.equal(formatResetIn('2030-01-01T02:05:00Z', now), '2h 5m');
  assert.equal(formatResetIn('2030-01-04T04:00:00Z', now), '3d 4h');
});

test('quotaBar', () => {
  assert.equal(quotaBar(0), '▱▱▱▱▱▱▱▱▱▱');
  assert.equal(quotaBar(13), '▰▱▱▱▱▱▱▱▱▱');
  assert.equal(quotaBar(100), '▰▰▰▰▰▰▰▰▰▰');
  assert.equal(quotaBar(undefined, 4), '▱▱▱▱');
});
