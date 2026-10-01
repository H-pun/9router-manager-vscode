/** Pure helpers for talking to the 9Router dashboard. No `vscode` imports. */

export const AUTH_COOKIE_NAME = 'auth_token';

/**
 * Normalize a user-entered server URL to its origin + path prefix, stripping
 * trailing slashes and any `/v1`, `/api` or `/dashboard` suffix the user may
 * have pasted. Returns `undefined` for unparsable URLs.
 */
export function normalizeServerUrl(raw: string): string | undefined {
  let value = raw.trim();
  if (!value) {
    return undefined;
  }
  if (!/^https?:\/\//i.test(value)) {
    value = `http://${value}`;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  let path = url.pathname.replace(/\/+$/, '');
  path = path.replace(/\/(v1|api|dashboard)(\/.*)?$/i, '');
  return `${url.protocol}//${url.host}${path}`;
}

/** OpenAI-compatible base URL (`…/v1`) for a normalized server URL. */
export function openAiBaseUrl(serverUrl: string): string {
  return `${serverUrl}/v1`;
}

/**
 * Extract the `auth_token` cookie value from one or more `Set-Cookie` header
 * values. Returns `undefined` if absent or explicitly cleared.
 */
export function extractAuthCookie(setCookieHeaders: readonly string[]): string | undefined {
  for (const header of setCookieHeaders) {
    const first = header.split(';', 1)[0] ?? '';
    const eq = first.indexOf('=');
    if (eq < 0) {
      continue;
    }
    const name = first.slice(0, eq).trim();
    const value = first.slice(eq + 1).trim();
    if (name === AUTH_COOKIE_NAME && value) {
      return value;
    }
  }
  return undefined;
}

/** Read all Set-Cookie headers from a fetch Response in a runtime-agnostic way. */
export function getSetCookies(headers: Headers): string[] {
  const withGetter = headers as Headers & { getSetCookie?: () => string[] };
  if (typeof withGetter.getSetCookie === 'function') {
    return withGetter.getSetCookie();
  }
  const single = headers.get('set-cookie');
  return single ? [single] : [];
}

/** Mask an API key for display: `sk-abc…wxyz`. */
export function maskKey(key: string): string {
  if (key.length <= 12) {
    return `${key.slice(0, 3)}…`;
  }
  return `${key.slice(0, 6)}…${key.slice(-4)}`;
}

/** Best-effort error text from a JSON or text response body. */
export function bodyErrorText(body: unknown, fallback: string): string {
  if (body && typeof body === 'object') {
    const obj = body as Record<string, unknown>;
    if (typeof obj.error === 'string' && obj.error) {
      return obj.error;
    }
    if (typeof obj.message === 'string' && obj.message) {
      return obj.message;
    }
  }
  if (typeof body === 'string' && body.trim()) {
    return body.trim().slice(0, 300);
  }
  return fallback;
}
