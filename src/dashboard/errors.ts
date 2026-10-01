/** Error raised by the dashboard client. `code` lets callers pick the right UI. */
export type DashboardErrorCode =
  | 'unauthorized'
  | 'invalidPassword'
  | 'rateLimited'
  | 'mustChangePassword'
  | 'passwordLoginDisabled'
  | 'forbidden'
  | 'network'
  | 'timeout'
  | 'http'
  | 'notSignedIn';

export class DashboardError extends Error {
  constructor(
    message: string,
    public readonly code: DashboardErrorCode,
    public readonly status?: number,
    public readonly retryAfter?: number
  ) {
    super(message);
    this.name = 'DashboardError';
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
