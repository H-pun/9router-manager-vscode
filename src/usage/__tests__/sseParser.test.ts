import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SseParser } from '../sseParser';

test('parses events split across chunks and ignores comments', () => {
  const p = new SseParser();
  assert.deepEqual(p.push('data: {"a":'), []);
  assert.deepEqual(p.push('1}\n\n: ping\n\ndata: {"b":2}\r\n\r\n'), ['{"a":1}', '{"b":2}']);
});

test('joins multi-line data', () => {
  const p = new SseParser();
  assert.deepEqual(p.push('data: x\ndata: y\n\n'), ['x\ny']);
});
