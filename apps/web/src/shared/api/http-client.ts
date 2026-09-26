import { httpBehavior } from '@ai-runtime/contracts/http';
import { RetryBudget, retryPause, transient } from './retry-policy';
import {
  ContractNoBody,
  unaryHttpPolicy,
  responseSchema,
  type ApiFetcherArgs,
} from '@ai-runtime/contracts/http';
import { ApiClientError, readApiError, retryAfterMs } from './http-error';
import {
  boundedResponseText,
  discardBody,
  ResponseReadError,
} from './bounded-response';
import { requestScope, type RequestScope } from './request-scope';

export interface HttpClientLimits {
  timeoutMs?: number;
  maxResponseBytes?: number;
  maxAttempts?: number;
}

function boundedLimit(value: number | undefined, ceiling: number): number {
  if (value === undefined) {
    return ceiling;
  }
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError('Invalid HTTP limit.');
  }
  return Math.min(value, ceiling);
}

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
    const response = await transport(path, {
      ...options,
      headers,
      credentials: 'same-origin',
      redirect: 'error',
      cache: 'no-store',
    });
    if (options.signal?.aborted) {
      discardBody(response);
      options.signal.throwIfAborted();
    }
    return response;
  } catch (cause) {
    throw transportError(cause, options.signal);
  }
}

async function read(
  response: Response,
  scope: RequestScope,
  limit: number,
): Promise<string> {
  try {
    return await boundedResponseText(response, limit, scope);
  } catch (cause) {
    if (cause instanceof ResponseReadError) {
      throw invalidResponse(response, cause.code);
    }
    throw transportError(cause, scope.signal, response);
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
    retryAfterMs: retryAfterMs(response.headers.get('retry-after')),
  });
}

/** The route supplies response types; callers cannot select a URL/DTO pair.
 * This is a bounded unary client, deliberately not an SSE decoder. */
async function fetchAttempt(
  args: ApiFetcherArgs,
  transport: typeof fetch = fetch,
  maxBytes: number,
  scope: RequestScope,
): Promise<{ status: number; body: unknown; headers: Headers }> {
  let sent = false;
  let response: Response | undefined;
  try {
    scope.check();
    response = await scope.wait(
      send(
        args.path,
        {
          ...args.fetchOptions,
          method: args.method,
          headers: args.headers,
          body: args.body,
          signal: scope.signal,
        },
        (path, options) => {
          sent = true;
          return transport(path, options);
        },
      ),
    );
    if (!response.ok) {
      let text = '';
      if (jsonMediaType(response)) {
        try {
          text = await read(
            response,
            scope,
            Math.min(maxBytes, unaryHttpPolicy.maxErrorBytes),
          );
        } catch (error) {
          if (
            !(error instanceof ApiClientError) ||
            error.kind !== 'invalid-response'
          ) {
            throw error;
          }
          // Keep HTTP status even when an error diagnostic is oversized or corrupt.
        }
      } else {
        discardBody(response);
      }
      throwHttpError(response, text);
    }
    const noBody = args.route.responses[response.status] === ContractNoBody;
    const schema = responseSchema(args.route, response.status);
    if (!noBody && !schema) {
      discardBody(response);
      throw invalidResponse(response, 'UNDECLARED_STATUS');
    }
    if (!noBody && !jsonMediaType(response)) {
      discardBody(response);
      throw invalidResponse(response, 'UNEXPECTED_CONTENT_TYPE');
    }
    const text = await read(response, scope, maxBytes);
    if (noBody) {
      if (text.length) {
        throw invalidResponse(response, 'UNEXPECTED_RESPONSE_BODY');
      }
      return {
        status: response.status,
        body: undefined,
        headers: response.headers,
      };
    }
    if (!text.trim()) {
      throw invalidResponse(response, 'EMPTY_RESPONSE');
    }
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch (cause) {
      throw invalidResponse(response, 'INVALID_JSON', cause);
    }
    const decoded = schema!.safeParse(data);
    if (!decoded.success) {
      throw invalidResponse(response, 'INVALID_RESPONSE');
    }
    scope.check();
    return {
      status: response.status,
      body: decoded.data,
      headers: response.headers,
    };
  } catch (cause) {
    const error =
      cause instanceof ApiClientError
        ? cause
        : transportError(cause, scope.signal, response);
    const rejected =
      error.kind === 'http' &&
      error.status !== null &&
      error.status >= 400 &&
      error.status < 500 &&
      error.status !== 408;
    throw new ApiClientError({
      ...error,
      message: error.serverMessage,
      cause: error.cause,
      outcome: !sent
        ? 'not-sent'
        : args.method === 'GET'
          ? 'not-applicable'
          : rejected
            ? 'rejected'
            : 'unknown',
    });
  }
}

const defaultRetryBudget = new RetryBudget();
/** One logical request, one deadline, frozen key/body, and one retry owner. */
export async function fetchContract(
  args: ApiFetcherArgs,
  transport: typeof fetch = fetch,
  limits: HttpClientLimits = {},
  retryBudget: RetryBudget = defaultRetryBudget,
): Promise<{ status: number; body: unknown; headers: Headers }> {
  const behavior = httpBehavior(args.route);
  const maxBytes = boundedLimit(
    limits.maxResponseBytes,
    behavior.maxResponseBytes,
  );
  const scope = requestScope(
    boundedLimit(limits.timeoutMs, unaryHttpPolicy.timeoutMs),
    args.fetchOptions?.signal,
  );
  const headers = Object.fromEntries(new Headers(args.headers));
  const frozen = { ...args, headers };
  const keyed =
    typeof headers['idempotency-key'] === 'string' &&
    /^[A-Za-z0-9._:-]{1,160}$/.test(headers['idempotency-key']);
  const replayable =
    (behavior.replay === 'same-key' || behavior.replay === 'receipt') &&
    keyed &&
    typeof args.body === 'string';
  const attempts = replayable
    ? boundedLimit(limits.maxAttempts, behavior.maxAttempts)
    : 1;
  let uncertain = false;
  try {
    for (let attempt = 1; ; attempt++) {
      try {
        return await fetchAttempt(frozen, transport, maxBytes, scope);
      } catch (cause) {
        if (cause instanceof ApiClientError && cause.outcome === 'unknown') {
          uncertain = true;
        }
        const delay = transient(cause)
          ? Math.max(
              cause.retryAfterMs ?? 0,
              Math.random() * Math.min(1000, 100 * 2 ** (attempt - 1)),
            )
          : 0;
        if (
          attempt >= attempts ||
          !transient(cause) ||
          scope.signal.aborted ||
          delay + 5 >= scope.remainingMs() ||
          !retryBudget.acquire()
        ) {
          if (
            uncertain &&
            cause instanceof ApiClientError &&
            cause.outcome !== 'unknown'
          ) {
            throw new ApiClientError({
              ...cause,
              message: cause.serverMessage,
              outcome: 'unknown',
              cause,
            });
          }
          throw cause;
        }
        try {
          await retryPause(delay, scope);
        } catch (error) {
          const aborted = transportError(error, scope.signal);
          throw new ApiClientError({
            ...aborted,
            message: aborted.serverMessage,
            outcome: uncertain ? 'unknown' : 'not-sent',
            cause: error,
          });
        }
      }
    }
  } finally {
    scope.dispose();
  }
}
