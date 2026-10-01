import type { WebviewToHost } from '../../src/quota/protocol';
import type { UsageWebviewToHost } from '../../src/usage/protocol';

const api = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : undefined;

export function post(message: WebviewToHost | UsageWebviewToHost): void {
  if (api) {
    api.postMessage(message);
  } else {
    // Running in a plain browser (vite dev) — just log.
    console.info('[postMessage]', message);
  }
}
