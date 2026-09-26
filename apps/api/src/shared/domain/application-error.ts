export type ApplicationErrorCode =
  | 'INVALID_REQUEST'
  | 'UNAUTHENTICATED'
  | 'POLICY_DENIED'
  | 'NOT_FOUND'
  | 'IDEMPOTENCY_CONFLICT'
  | 'REQUEST_KEY_EXPIRED'
  | 'STREAM_RESUME_EXPIRED'
  | 'STALE_ASSIGNMENT'
  | 'VERSION_UNSUPPORTED'
  | 'RESOURCE_EXHAUSTED'
  | 'EXECUTION_IN_PROGRESS'
  | 'UPSTREAM_REJECTED'
  | 'UPSTREAM_RATE_LIMITED'
  | 'STRUCTURED_OUTPUT_INVALID'
  | 'DEPENDENCY_UNAVAILABLE';

export class ApplicationError extends Error {
  constructor(
    readonly code: ApplicationErrorCode,
    message: string,
    readonly executionId?: string,
  ) {
    super(message);
    this.name = 'ApplicationError';
  }
}
