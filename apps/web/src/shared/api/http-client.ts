import {
  ContractNoBody,
  responseSchema,
  type ApiFetcherArgs,
} from '@ai-runtime/contracts/http';
import { ApiClientError, readApiError } from './http-error';

export {
  ApiClientError,
  errorMessage,
  isRequestAborted,
  toError,
} from './http-error';
export type {
  ApiErrorPayload,
  ApiErrorResponse,
  ClientErrorKind,
} from './http-error';

function jsonMediaType(response: Response): boolean {
  const mediaType = response.headers
    .get('content-type')
    ?.split(';')[0]
    .trim()
    .toLowerCase();
  return (
    mediaType === 'application/json' ||
    Boolean(
      mediaType && /^application\/[a-z0-9!#$&^_.+-]+\+json$/.test(mediaType),
    )
  );
}

function interrupted(
  error: unknown,
  signal: AbortSignal | null | undefined,
): 'timeout' | 'aborted' | null {
  const reason: unknown = signal?.aborted ? signal.reason : error;
  if (reason instanceof Error && reason.name === 'TimeoutError') {
    return 'timeout';
  }
  if (
    signal?.aborted ||
    (reason instanceof Error && reason.name === 'AbortError')
  ) {
    return 'aborted';
  }
  return null;
}

function transportError(
  cause: unknown,
  signal: AbortSignal | null | undefined,
  response?: Response,
): ApiClientError {
  const kind = interrupted(cause, signal) ?? 'network';
  return new ApiClientError({
    kind,
    status: response?.status ?? null,
    code:
      kind === 'timeout'
        ? 'REQUEST_TIMEOUT'
        : kind === 'aborted'
          ? 'REQUEST_ABORTED'
          : 'NETWORK_ERROR',
    message:
      kind === 'timeout'
        ? 'Waktu tunggu request habis.'
        : kind === 'aborted'
          ? 'Request dibatalkan.'
          : 'Respons layanan belum dapat diterima. Periksa koneksi dan coba lagi.',
    requestId: response?.headers.get('x-request-id') ?? undefined,
    cause,
  });
}

function invalidResponse(
  response: Response,
  code: string,
  cause?: unknown,
): ApiClientError {
  return new ApiClientError({
    kind: 'invalid-response',
    status: response.status,
    code,
    message: 'Respons layanan tidak sesuai kontrak yang diharapkan.',
    requestId: response.headers.get('x-request-id') ?? undefined,
    cause,
  });
}

async function send(
  path: string,
  options: RequestInit,
  transport: typeof fetch = fetch,
): Promise<Response> {
  // This browser transport addresses this application's BFF, not arbitrary external services.
  if (!path.startsWith('/api/') || path.includes('\\') || /[\r\n]/.test(path)) {
    throw new TypeError('Use a root-relative /api/ path for BFF requests.');
  }
  const headers = new Headers(options.headers);
  if (!headers.has('Accept')) {
    headers.set('Accept', 'application/json');
  }
  if (typeof options.body === 'string' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  try {
    options.signal?.throwIfAborted();
    return await transport(path, {
      ...options,
      headers,
      credentials: 'same-origin',
      redirect: 'error',
      cache: 'no-store',
    });
  } catch (cause) {
    throw transportError(cause, options.signal);
  }
}

async function read(
  response: Response,
  signal: AbortSignal | null | undefined,
): Promise<string> {
  try {
    const text = await response.text();
    signal?.throwIfAborted();
    return text;
  } catch (cause) {
    throw transportError(cause, signal, response);
  }
}

function throwHttpError(response: Response, text: string): never {
  let body: unknown;
  if (text && jsonMediaType(response)) {
    try {
      body = JSON.parse(text);
    } catch {
      // HTML/empty/malformed error bodies must not erase the HTTP failure status.
    }
  }
  const error = readApiError(body);
  throw new ApiClientError({
    kind: 'http',
    status: response.status,
    code: error.code ?? 'HTTP_' + response.status,
    message: error.message ?? 'Request gagal (HTTP ' + response.status + ').',
    fields: error.fields,
    details: error.details,
    retryable: error.retryable,
    requestId: response.headers.get('x-request-id') ?? error.request_id,
    executionId: error.execution_id,
  });
}

/** The route supplies response types; callers cannot select a URL/DTO pair. */
export async function fetchContract(
  args: ApiFetcherArgs,
  transport: typeof fetch = fetch,
): Promise<{ status: number; body: unknown; headers: Headers }> {
  const options = {
    ...args.fetchOptions,
    method: args.method,
    headers: args.headers,
    body: args.body,
  };
  const response = await send(args.path, options, transport);
  const text = await read(response, options.signal);
  if (!response.ok) {
    throwHttpError(response, text);
  }
  if (args.route.responses[response.status] === ContractNoBody) {
    if (text.trim()) {
      throw invalidResponse(response, 'UNEXPECTED_RESPONSE_BODY');
    }
    return {
      status: response.status,
      body: undefined,
      headers: response.headers,
    };
  }
  const schema = responseSchema(args.route, response.status);
  if (!schema) {
    throw invalidResponse(response, 'UNDECLARED_STATUS');
  }
  if (!text.trim()) {
    throw invalidResponse(response, 'EMPTY_RESPONSE');
  }
  if (!jsonMediaType(response)) {
    throw invalidResponse(response, 'UNEXPECTED_CONTENT_TYPE');
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (cause) {
    throw invalidResponse(response, 'INVALID_JSON', cause);
  }
  const decoded = schema.safeParse(data);
  if (!decoded.success) {
    throw invalidResponse(response, 'INVALID_RESPONSE');
  }
  return {
    status: response.status,
    body: decoded.data,
    headers: response.headers,
  };
}
