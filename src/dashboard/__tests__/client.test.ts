import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CredentialStore, DashboardClient } from '../client';
import { DashboardError } from '../errors';

const URL_ = 'http://router.test';

class MemoryStore implements CredentialStore {
  tokens = new Map<string, string>();
  passwords = new Map<string, string>();
  async getToken(u: string) { return this.tokens.get(u); }
  async setToken(u: string, t: string | undefined) { t ? this.tokens.set(u, t) : this.tokens.delete(u); }
  async getPassword(u: string) { return this.passwords.get(u); }
  async setPassword(u: string, p: string | undefined) { p ? this.passwords.set(u, p) : this.passwords.delete(u); }
}

interface Call { method: string; path: string; cookie?: string; body?: unknown }

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

function makeClient(handler: (call: Call) => Response) {
  const store = new MemoryStore();
  const calls: Call[] = [];
  const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const call: Call = {
      method: init?.method ?? 'GET',
      path: url.pathname,
      cookie: headers.Cookie,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(call);
    return handler(call);
  }) as typeof fetch;
  const client = new DashboardClient({ store, fetch: fakeFetch });
  client.setServerUrl(URL_);
  return { client, store, calls };
}

test('login stores cookie and password', async () => {
  const { client, store } = makeClient(() =>
    json(200, { success: true }, { 'set-cookie': 'auth_token=jwt1; Path=/; HttpOnly' })
  );
  await client.login('pw');
  assert.equal(await store.getToken(URL_), 'jwt1');
  assert.equal(await store.getPassword(URL_), 'pw');
});

test('login maps error statuses to codes', async () => {
  const cases: Array<[Response, string]> = [
    [json(401, { error: 'Invalid password.' }), 'invalidPassword'],
    [json(429, { error: 'Too many', retryAfter: 30 }), 'rateLimited'],
    [json(403, { success: false, mustChangePassword: true, error: 'Default password' }), 'mustChangePassword'],
    [json(403, { error: 'Password login is disabled. Use OIDC sign in.' }), 'passwordLoginDisabled'],
  ];
  for (const [res, code] of cases) {
    const { client } = makeClient(() => res);
    await assert.rejects(client.login('x'), (e: unknown) => e instanceof DashboardError && e.code === code);
  }
});

test('request sends cookie and re-logs in once on 401', async () => {
  let loggedIn = false;
  const { client, store, calls } = makeClient((call) => {
    if (call.path === '/api/auth/login') {
      loggedIn = true;
      return json(200, { success: true }, { 'set-cookie': 'auth_token=fresh; Path=/' });
    }
    if (call.cookie === 'auth_token=fresh' && loggedIn) {
      return json(200, { keys: [{ id: 'k1', key: 'sk-1', name: 'a', isActive: true }] });
    }
    return json(401, { error: 'Unauthorized' });
  });
  await store.setToken(URL_, 'expired');
  await store.setPassword(URL_, 'pw');

  const keys = await client.listKeys();
  assert.equal(keys.length, 1);
  assert.deepEqual(
    calls.map((c) => `${c.method} ${c.path}`),
    ['GET /api/keys', 'POST /api/auth/login', 'GET /api/keys']
  );
  assert.equal(await store.getToken(URL_), 'fresh');
});

test('request throws unauthorized without stored password', async () => {
  const { client, store } = makeClient(() => json(401, { error: 'Unauthorized' }));
  await store.setToken(URL_, 'expired');
  await assert.rejects(client.getSettings(), (e: unknown) => e instanceof DashboardError && e.code === 'unauthorized');
  assert.equal(await store.getToken(URL_), undefined);
});

test('patchSettings sends body and returns server settings', async () => {
  const { client, calls } = makeClient((call) => json(200, { rtkEnabled: false, ...(call.body as object) }));
  const result = await client.patchSettings({ rtkEnabled: false });
  assert.equal(result.rtkEnabled, false);
  assert.deepEqual(calls[0]?.body, { rtkEnabled: false });
  assert.equal(calls[0]?.method, 'PATCH');
});

test('network failure maps to network error', async () => {
  const store = new MemoryStore();
  const client = new DashboardClient({
    store,
    fetch: (async () => { throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } }); }) as typeof fetch,
  });
  client.setServerUrl(URL_);
  await assert.rejects(client.health(), (e: unknown) => e instanceof DashboardError && e.code === 'network' && /ECONNREFUSED/.test(e.message));
});
