import { HttpErrorPayload } from '@ai-runtime/contracts/http';
export type ClientErrorKind =
  'http' | 'network' | 'timeout' | 'aborted' | 'invalid-response';

export type {
  ApiErrorPayload,
  ApiErrorResponse,
} from '@ai-runtime/contracts/http';
import type { ApiErrorPayload } from '@ai-runtime/contracts/http';

export type RequestOutcome =
  'not-sent' | 'not-applicable' | 'rejected' | 'unknown';

/** Retry-After is a server delay hint, never permission to replay a mutation. */
export function retryAfterMs(
  value: string | null,
  now = Date.now(),
): number | undefined {
  if (!value || value.length > 128) {
    return undefined;
  }
  const text = value.trim();
  const delay = /^[0-9]+$/.test(text)
    ? Number(text) * 1000
    : /^[A-Za-z]{3}, /.test(text)
      ? Date.parse(text) - now
      : NaN;
  return Number.isFinite(delay) && delay >= 0
    ? Math.min(delay, 86_400_000)
    : undefined;
}

export interface ApiClientErrorOptions {
  kind: ClientErrorKind;
  status: number | null;
  code: string;
  message: string;
  fields?: Record<string, string>;
  details?: unknown;
  retryable?: boolean;
  requestId?: string;
  executionId?: string | null;
  cause?: unknown;
  outcome?: RequestOutcome;
  retryAfterMs?: number;
}

export class ApiClientError extends Error {
  readonly kind: ClientErrorKind;
  readonly status: number | null;
  readonly code: string;
  readonly serverMessage: string;
  readonly fields?: Readonly<Record<string, string>>;
  readonly details?: unknown;
  readonly retryable?: boolean;
  readonly requestId?: string;
  readonly executionId?: string | null;
  readonly outcome?: RequestOutcome;
  readonly retryAfterMs?: number;

  constructor(options: ApiClientErrorOptions) {
    super(options.code + ': ' + options.message, { cause: options.cause });
    this.name = 'ApiClientError';
    this.kind = options.kind;
    this.status = options.status;
    this.code = options.code;
    this.serverMessage = options.message;
    this.fields = options.fields
      ? Object.freeze({ ...options.fields })
      : undefined;
    this.details = options.details;
    this.retryable = options.retryable;
    this.requestId = options.requestId;
    this.executionId = options.executionId;
    this.outcome = options.outcome;
    this.retryAfterMs = options.retryAfterMs;
  }

  getFieldError(field: string): string | undefined {
    return this.fields && Object.hasOwn(this.fields, field)
      ? this.fields[field]
      : undefined;
  }
}

/** Parse each optional diagnostic using its canonical shared schema. */
export function readApiError(value: unknown): Partial<ApiErrorPayload> {
  if (
    !value ||
    typeof value !== 'object' ||
    !('error' in value) ||
    !value.error ||
    typeof value.error !== 'object' ||
    Array.isArray(value.error)
  ) {
    return {};
  }
  const error = value.error;
  return Object.fromEntries(
    Object.entries(HttpErrorPayload.shape).flatMap(([name, schema]) => {
      const result = schema.safeParse(Reflect.get(error, name));
      return result.success && result.data !== undefined
        ? [[name, result.data]]
        : [];
    }),
  );
}

export function isRequestAborted(error: unknown): boolean {
  return error instanceof ApiClientError
    ? error.kind === 'aborted'
    : error instanceof Error && error.name === 'AbortError';
}

export function toError(error: unknown): Error {
  return error instanceof Error
    ? error
    : new Error('Terjadi kesalahan yang tidak dikenal.', { cause: error });
}

export function errorMessage(error: unknown): string {
  return toError(error).message;
}
