import { ApplicationError } from '../../../shared/domain/application-error.js';

export function requireIdempotencyKey(value: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:@/-]{0,159}$/.test(value)) {
    throw new ApplicationError(
      'INVALID_REQUEST',
      'Idempotency-Key must contain 1â€“160 safe characters.',
    );
  }
  return value;
}
