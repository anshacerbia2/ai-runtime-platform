export type ApplicationErrorCode =
  | 'INVALID_REQUEST'
  | 'UNAUTHENTICATED'
  | 'POLICY_DENIED'
  | 'NOT_FOUND'
  | 'IDEMPOTENCY_CONFLICT'
  | 'DEPENDENCY_UNAVAILABLE';

export class ApplicationError extends Error {
  constructor(
    readonly code: ApplicationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ApplicationError';
  }
}
