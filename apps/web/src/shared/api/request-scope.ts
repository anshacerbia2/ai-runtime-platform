/** One deadline covers transport AND body consumption. Cancellation is local
 * transport cancellation, never proof that a durable server mutation rolled back. */
export function requestScope(timeoutMs: number, parent?: AbortSignal | null) {
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 2_147_483_647
  ) {
    throw new RangeError('Request timeout must be a positive bounded integer.');
  }
  const controller = new AbortController();
  const expiresAt = performance.now() + timeoutMs;
  const expire = () =>
    controller.abort(
      new DOMException('Request deadline exceeded.', 'TimeoutError'),
    );
  const onParent = () => controller.abort(parent?.reason);
  parent?.addEventListener('abort', onParent, { once: true });
  if (parent?.aborted) {
    onParent();
  }
  const timer = setTimeout(expire, timeoutMs);
  const check = () => {
    if (!controller.signal.aborted && performance.now() >= expiresAt) {
      expire();
    }
    controller.signal.throwIfAborted();
  };
  return {
    signal: controller.signal,
    remainingMs: () => Math.max(0, expiresAt - performance.now()),
    check,
    async wait<T>(promise: Promise<T>): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        const abort = () => fail(controller.signal.reason);
        const cleanup = () =>
          controller.signal.removeEventListener('abort', abort);
        const fail = (error: unknown) => {
          cleanup();
          reject(error);
        };
        controller.signal.addEventListener('abort', abort, { once: true });
        void promise.then((value) => {
          try {
            check();
            cleanup();
            resolve(value);
          } catch (error) {
            fail(error);
          }
        }, fail);
        try {
          check();
        } catch (error) {
          fail(error);
        }
      });
    },
    dispose() {
      clearTimeout(timer);
      parent?.removeEventListener('abort', onParent);
    },
  };
}

export type RequestScope = ReturnType<typeof requestScope>;
