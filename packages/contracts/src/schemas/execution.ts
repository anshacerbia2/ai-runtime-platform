import { z } from 'zod';
import { id } from './requests.js';

export const ExecutionStatus = z.enum([
  'ACCEPTED',
  'QUEUED',
  'RUNNING',
  'CANCEL_REQUESTED',
  'RECONCILING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'TIMED_OUT',
]);

export const Attempt = z.strictObject({
  attempt_id: id,
  status: z.enum([
    'PREPARED',
    'DISPATCHED',
    'RUNNING',
    'ORPHAN_SUSPENDED',
    'ABANDONED',
    'SUCCEEDED',
    'FAILED',
    'CANCELLED',
    'TIMED_OUT',
  ]),
  authority: z.enum(['UNASSIGNED', 'ACTIVE', 'LOST', 'FENCED', 'RELEASED']),
  local_compute: z.enum([
    'NOT_APPLICABLE',
    'STARTING',
    'RUNNING',
    'TERMINATING',
    'EXITED',
    'KILLED',
    'UNKNOWN',
  ]),
  external_operations: z.enum([
    'NONE',
    'IN_FLIGHT',
    'COMMITTED',
    'FAILED',
    'MIXED',
    'UNKNOWN_IN_FLIGHT',
  ]),
  accounting: z.enum([
    'UNRESERVED',
    'RESERVED',
    'PENDING_RECONCILIATION',
    'SETTLED',
    'OVERAGE_SETTLED',
  ]),
});

export const Usage = z.strictObject({
  measurement_status: z.enum(['complete', 'partial', 'pending', 'unknown']),
  cost_basis: z.enum([
    'provider_reported',
    'estimated',
    'allocated',
    'unknown',
  ]),
  provider_cost: z
    .string()
    .regex(/^\d+(\.\d+)?$/)
    .nullable(),
});

export const Result = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('text'),
    text: z.string(),
    artifact_refs: z.array(id),
  }),
  z.strictObject({
    kind: z.literal('structured'),
    value: z.unknown(),
    artifact_refs: z.array(id),
  }),
  z.strictObject({
    kind: z.literal('artifacts'),
    artifact_refs: z.array(id).min(1),
  }),
  z.strictObject({
    kind: z.literal('mixed'),
    text: z.string(),
    artifact_refs: z.array(id),
  }),
]);

export const Snapshot = z.strictObject({
  execution_id: id,
  revision: z.number().int().min(1),
  status: ExecutionStatus,
  status_reason: z.string().nullable(),
  profile_revision: id,
  attempts: z.array(Attempt),
  result: Result.nullable(),
  usage: Usage,
  links: z.strictObject({ self: z.string(), events: z.string() }),
});

export function validateSnapshot(value: unknown): boolean {
  const parsed = Snapshot.safeParse(value);
  if (!parsed.success) {
    return false;
  }
  return parsed.data.status !== 'COMPLETED' || parsed.data.result !== null;
}
