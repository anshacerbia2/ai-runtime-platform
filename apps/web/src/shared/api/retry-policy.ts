import { ApiClientError } from './http-error';
import type { RequestScope } from './request-scope';
/** Per-client load budget; this is not a global fleet quota or a server authorization mechanism. */
export class RetryBudget {
  private tokens: number;
  private at = performance.now();
  constructor(
    private readonly capacity = 10,
    private readonly refillPerSecond = 1,
  ) {
    this.tokens = capacity;
  }
  acquire() {
    const now = performance.now();
    this.tokens = Math.min(
      this.capacity,
      this.tokens + ((now - this.at) * this.refillPerSecond) / 1000,
    );
    this.at = now;
    if (this.tokens < 1) {
      return false;
    }
    this.tokens--;
    return true;
  }
}
export function transient(error: unknown): error is ApiClientError {
  return (
    error instanceof ApiClientError &&
    error.retryable !== false &&
    (error.kind === 'network' ||
      (error.kind === 'http' && [502, 503, 504].includes(error.status ?? 0)))
  );
}
export async function retryPause(ms: number, scope: RequestScope) {
  scope.check();
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => scope.signal.removeEventListener('abort', abort);
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const abort = () => {
      clearTimeout(timer);
      cleanup();
      reject(scope.signal.reason);
    };
    scope.signal.addEventListener('abort', abort, { once: true });
    if (scope.signal.aborted) {
      abort();
    }
  });
  scope.check();
}
