import type { AppRoute } from '@ts-rest/core';
import { z } from 'zod';
export const unaryHttpPolicy = Object.freeze({
  transport: 'unary-json' as const,
  timeoutMs: 30000,
  maxResponseBytes: 8388608,
  maxErrorBytes: 65536,
  maxAttempts: 1,
  unknownResponseFields: 'strip' as const,
});
const Behavior = z.object({
  replay: z.enum(['none', 'read', 'same-key', 'receipt']),
  maxAttempts: z.number().int().min(1).max(3),
  maxResponseBytes: z
    .number()
    .int()
    .positive()
    .max(unaryHttpPolicy.maxResponseBytes)
    .optional(),
  fingerprint: z.string().optional(),
  receiptReplayDays: z.number().int().positive().optional(),
  retainedTombstones: z.boolean().optional(),
  retryOwner: z.literal('client').optional(),
});
/** Permission to replay is an operation declaration, never inferred from an arbitrary header. */
export function httpBehavior(route: AppRoute) {
  const metadata = route.metadata as { behavior?: unknown } | undefined;
  const behavior =
    metadata?.behavior === undefined
      ? {
          replay:
            route.method === 'GET' ? ('read' as const) : ('none' as const),
          maxAttempts: 1,
        }
      : Behavior.parse(metadata.behavior);
  return {
    ...unaryHttpPolicy,
    ...behavior,
    automaticRetry: behavior.maxAttempts > 1 ? 'bounded-client-only' : 'never',
    ambiguousMutation: 'unknown-until-reconciled',
    ...(behavior.replay === 'same-key' || behavior.replay === 'receipt'
      ? {
          idempotency: {
            header: 'idempotency-key',
            maxLength: 160,
            fingerprint: behavior.fingerprint,
            conflictStatus: 409,
          },
        }
      : {}),
  };
}
