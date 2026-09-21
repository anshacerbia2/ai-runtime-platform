import { z } from 'zod';
import { id } from './requests.js';

export const Event = z.strictObject({
  schema_version: z.literal('1'),
  event_id: id,
  execution_id: id,
  attempt_id: id.optional(),
  stream_epoch: id,
  occurred_at: z.iso.datetime(),
  type: z.enum([
    'execution.accepted',
    'execution.started',
    'attempt.started',
    'attempt.orphaned',
    'attempt.ended',
    'model.started',
    'model.delta',
    'tool.started',
    'tool.completed',
    'usage.updated',
    'execution.cancel_requested',
    'execution.completed',
    'execution.failed',
    'execution.cancelled',
    'execution.timed_out',
    'stream.reset_required',
  ]),
  sequence: z.number().int().nonnegative(),
  payload: z.record(z.string(), z.unknown()),
});

export const CancelRequest = z.strictObject({
  reason: z.string().max(500).optional(),
});

export const ToolOperation = z.strictObject({
  operation_id: id,
  idempotency_key: id,
  tool_ref: id,
  input: z.record(z.string(), z.unknown()),
  effect: z.enum(['read_only', 'mutating']),
  status: z.enum(['PENDING', 'IN_FLIGHT', 'COMMITTED', 'FAILED', 'UNKNOWN']),
});
