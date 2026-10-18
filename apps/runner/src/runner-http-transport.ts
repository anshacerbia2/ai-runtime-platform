export interface RunnerHttpOptions {
  origin: string;
  bearerToken: () => Promise<string>;
  timeoutMs: number;
  /** Fixture only; production requires HTTPS and enforced network policy. */
  allowHttpLoopbackForTests?: boolean;
  fetchImpl?: typeof fetch;
}

export class RunnerHttpError extends Error {
  constructor(readonly kind: 'UNAVAILABLE' | 'REJECTED' | 'INVALID') {
    super(`Runner HTTP ${kind.toLowerCase()}.`);
  }
}

const MAX_BYTES = 65_536;

async function boundedJson(response: Response): Promise<unknown> {
  const length = response.headers.get('content-length');
  if (
    response.redirected ||
    !response.body ||
    !/^application\/json(?:\s*;|\s*$)/i.test(
      response.headers.get('content-type') ?? '',
    ) ||
    (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_BYTES))
  ) {
    void response.body?.cancel().catch(() => undefined);
    throw new RunnerHttpError('INVALID');
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      bytes += value.byteLength;
      if (bytes > MAX_BYTES) {
        throw new RunnerHttpError('INVALID');
      }
      chunks.push(value);
    }
  } catch (error) {
    void reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
  } catch {
    throw new RunnerHttpError('INVALID');
  }
}

/** One bounded POST, including credential acquisition and body read; no retries. */
export class RunnerHttpTransport {
  private readonly origin: URL;
  private readonly token: () => Promise<string>;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: RunnerHttpOptions) {
    const origin = new URL(options.origin);
    if (
      origin.username ||
      origin.password ||
      origin.search ||
      origin.hash ||
      origin.pathname !== '/' ||
      !Number.isSafeInteger(options.timeoutMs) ||
      options.timeoutMs < 100 ||
      options.timeoutMs > 3_000 ||
      (origin.protocol !== 'https:' &&
        !(
          options.allowHttpLoopbackForTests &&
          origin.protocol === 'http:' &&
          ['127.0.0.1', '[::1]'].includes(origin.hostname)
        ))
    ) {
      throw new Error('Invalid trusted runner API origin or timeout.');
    }
    this.origin = origin;
    this.token = options.bearerToken;
    this.timeoutMs = options.timeoutMs;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async post(
    path: string,
    value: unknown,
    caller?: AbortSignal,
  ): Promise<unknown> {
    const url = new URL(path, this.origin);
    const body = JSON.stringify(value);
    if (
      !path.startsWith('/') ||
      url.origin !== this.origin.origin ||
      url.search ||
      url.hash ||
      new TextEncoder().encode(body).byteLength > MAX_BYTES
    ) {
      throw new RunnerHttpError('INVALID');
    }
    if (caller?.aborted) {
      throw new RunnerHttpError('UNAVAILABLE');
    }
    const controller = new AbortController();
    let onAbort!: () => void;
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => {
        controller.abort();
        reject(new RunnerHttpError('UNAVAILABLE'));
      };
      caller?.addEventListener('abort', onAbort, { once: true });
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new RunnerHttpError('UNAVAILABLE'));
      }, this.timeoutMs);
    });
    const work = Promise.resolve().then(async () => {
      if (controller.signal.aborted) {
        throw new RunnerHttpError('UNAVAILABLE');
      }
      let token: string;
      try {
        token = await this.token();
      } catch {
        throw new RunnerHttpError('REJECTED');
      }
      if (controller.signal.aborted) {
        throw new RunnerHttpError('UNAVAILABLE');
      }
      if (
        typeof token !== 'string' ||
        !token ||
        !/^[\x21-\x7e]+$/.test(token)
      ) {
        throw new RunnerHttpError('REJECTED');
      }
      const response = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          accept: 'application/json',
          'content-type': 'application/json',
          'x-runner-protocol': '1',
        },
        body,
        redirect: 'error',
        cache: 'no-store',
        signal: controller.signal,
      });
      if (controller.signal.aborted || response.status !== 200) {
        void response.body?.cancel().catch(() => undefined);
        throw new RunnerHttpError(
          controller.signal.aborted ||
            response.status === 408 ||
            response.status === 429 ||
            response.status >= 500
            ? 'UNAVAILABLE'
            : 'REJECTED',
        );
      }
      return boundedJson(response);
    });
    try {
      return await Promise.race([work, aborted, deadline]);
    } catch (error) {
      throw error instanceof RunnerHttpError
        ? error
        : new RunnerHttpError('UNAVAILABLE');
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
      caller?.removeEventListener('abort', onAbort);
    }
  }
}
