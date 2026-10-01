import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractAuthCookie, maskKey, normalizeServerUrl, openAiBaseUrl } from '../http';

test('normalizeServerUrl strips suffixes and trailing slashes', () => {
  assert.equal(normalizeServerUrl('http://localhost:20128/'), 'http://localhost:20128');
  assert.equal(normalizeServerUrl('http://localhost:20128/v1'), 'http://localhost:20128');
  assert.equal(normalizeServerUrl('http://localhost:20128/dashboard/usage'), 'http://localhost:20128');
  assert.equal(normalizeServerUrl('https://example.com/router/api'), 'https://example.com/router');
  assert.equal(normalizeServerUrl('localhost:20128'), 'http://localhost:20128');
  assert.equal(normalizeServerUrl('  '), undefined);
  assert.equal(normalizeServerUrl('http://'), undefined);
});

test('openAiBaseUrl appends /v1', () => {
  assert.equal(openAiBaseUrl('http://h:1'), 'http://h:1/v1');
});

test('extractAuthCookie finds auth_token among cookies', () => {
  assert.equal(
    extractAuthCookie(['other=1; Path=/', 'auth_token=abc.def.ghi; Path=/; HttpOnly; SameSite=lax']),
    'abc.def.ghi'
  );
  assert.equal(extractAuthCookie(['auth_token=; Max-Age=0']), undefined);
  assert.equal(extractAuthCookie([]), undefined);
});

test('maskKey hides the middle', () => {
  assert.equal(maskKey('sk-1234567890abcdef'), 'sk-123…cdef');
  assert.equal(maskKey('short'), 'sho…');
});
