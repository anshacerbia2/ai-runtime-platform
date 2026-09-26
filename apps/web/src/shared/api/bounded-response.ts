import type { RequestScope } from './request-scope';

export class ResponseReadError extends Error {
  constructor(public readonly code: 'RESPONSE_TOO_LARGE' | 'INVALID_UTF8') {
    super(code);
  }
}

export function discardBody(response: Response): void {
  // A broken upstream cancel implementation must not hold the caller open.
  void response.body?.cancel().catch(() => {});
}

/** Bounded unary buffering. A growing byte buffer avoids one allocation/list
 * entry per tiny chunk; Content-Length is only an early rejection hint. */
export async function boundedResponseText(
  response: Response,
  limit: number,
  scope: RequestScope,
): Promise<string> {
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new RangeError('Invalid response byte limit.');
  }
  const length = response.headers.get('content-length');
  if (
    !response.headers.has('content-encoding') &&
    length &&
    /^\d+$/.test(length) &&
    Number(length) > limit
  ) {
    discardBody(response);
    throw new ResponseReadError('RESPONSE_TOO_LARGE');
  }
  if (!response.body) {
    scope.check();
    return '';
  }
  const reader = response.body.getReader();
  let buffer = new Uint8Array(Math.min(4096, limit));
  let size = 0;
  let complete = false;
  try {
    while (true) {
      const { value, done } = await scope.wait(reader.read());
      if (done) {
        complete = true;
        break;
      }
      const required = size + value.byteLength;
      if (required > limit) {
        throw new ResponseReadError('RESPONSE_TOO_LARGE');
      }
      if (required > buffer.byteLength) {
        const grown = new Uint8Array(
          Math.min(limit, Math.max(required, buffer.byteLength * 2)),
        );
        grown.set(buffer.subarray(0, size));
        buffer = grown;
      }
      buffer.set(value, size);
      size = required;
    }
    scope.check();
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(
        buffer.subarray(0, size),
      );
    } catch {
      throw new ResponseReadError('INVALID_UTF8');
    }
  } finally {
    if (!complete) {
      void reader.cancel().catch(() => {});
    }
    reader.releaseLock();
  }
}
