import { z } from 'zod';
import { id } from './requests.js';

export const ErrorEnvelope = z.strictObject({
  error: z.strictObject({
    code: z.enum([
      'INVALID_REQUEST',
      'UNAUTHENTICATED',
      'POLICY_DENIED',
      'NOT_FOUND',
      'IDEMPOTENCY_CONFLICT',
      'SESSION_BUSY',
      'STREAM_RESUME_EXPIRED',
      'RESOURCE_EXPIRED',
      'UNSUPPORTED_CAPABILITY',
      'BUDGET_EXHAUSTED',
      'RATE_LIMITED',
      'CAPACITY_EXHAUSTED',
      'DEPENDENCY_UNAVAILABLE',
      'WAIT_TIMEOUT',
      'NOT_IMPLEMENTED',
    ]),
    message: z.string(),
    retryable: z.boolean(),
    request_id: z.string(),
    execution_id: id.nullable(),
  }),
});
