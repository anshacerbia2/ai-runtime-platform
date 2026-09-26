import 'server-only';
import type { WebEnvironment } from '../../../../../config/environment.mjs';

export class HttpFailure extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
  ) {
    super(code);
  }
}

export function guardBrowserRequest(
  request: Request,
  config: WebEnvironment,
  mutation = false,
) {
  const permittedHosts = new Set(
    config.allowedOrigins.map((origin) => new URL(origin).host),
  );
  const host = request.headers.get('host') ?? new URL(request.url).host;
  if (
    !permittedHosts.has(host) ||
    request.headers.get('sec-fetch-site') === 'cross-site'
  ) {
    throw new HttpFailure(403, 'ORIGIN_DENIED');
  }
  const origin = request.headers.get('origin');
  if (
    (origin && !config.allowedOrigins.includes(origin)) ||
    (mutation && !origin)
  ) {
    throw new HttpFailure(403, 'ORIGIN_DENIED');
  }
}

export function cookieValue(request: Request, name: string): string {
  const matches = (request.headers.get('cookie') ?? '')
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.startsWith(name + '='));
  return matches.length === 1 ? matches[0].slice(name.length + 1) : '';
}

export function sessionCookie(
  name: string,
  reference: string,
  maxAge: number,
): string {
  return (
    name +
    '=' +
    reference +
    '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=' +
    maxAge
  );
}

export const safeHeaders = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
};

export function failure(error: unknown): Response {
  const known = error instanceof HttpFailure;
  return Response.json(
    {
      error: {
        code: known ? error.code : 'BFF_UNAVAILABLE',
        message: known
          ? error.code
          : 'The web service is temporarily unavailable.',
      },
    },
    { status: known ? error.status : 503, headers: safeHeaders },
  );
}

export async function boundedBody(
  stream: ReadableStream<Uint8Array> | null,
  limit: number,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  if (!stream) {
    return new Uint8Array();
  }
  const reader = stream.getReader();
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) {
    abort();
  }
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (signal?.aborted) {
        throw new HttpFailure(408, 'REQUEST_TIMEOUT');
      }
      if (done) {
        break;
      }
      size += value.byteLength;
      if (size > limit) {
        void reader.cancel().catch(() => {});
        throw new HttpFailure(413, 'PAYLOAD_TOO_LARGE');
      }
      parts.push(value);
    }
  } finally {
    signal?.removeEventListener('abort', abort);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  return bytes;
}
