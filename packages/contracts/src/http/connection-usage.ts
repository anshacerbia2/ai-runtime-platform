import { z } from 'zod';

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$/);
const timestamp = z.iso.datetime({ offset: true, precision: 3 });
const count = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/)
  .max(80);
export const ConnectionUsageQuery = z
  .object({
    from: timestamp,
    to: timestamp,
    applicationId: id.optional(),
    budgetAccountId: id.optional(),
  })
  .strict()
  .refine(
    ({ from, to }) => {
      const duration = Date.parse(to) - Date.parse(from);
      return duration > 0 && duration <= 31 * 86_400_000;
    },
    { message: 'Usage window must be positive and at most 31 days.' },
  );
export type ConnectionUsageInput = z.infer<typeof ConnectionUsageQuery>;
const tokenCounter = z.object({ known: count, unknownInvocations: count });
export const ConnectionUsageSummary = z.object({
  connectionId: id,
  applicationId: id.nullable(),
  from: timestamp,
  to: timestamp,
  observedAt: timestamp,
  consistency: z.literal('repeatable-read'),
  invocations: z.object({
    total: count,
    running: count,
    succeeded: count,
    failed: count,
    unknown: count,
  }),
  tokens: z.object({ input: tokenCounter, output: tokenCounter }),
  ledger: z
    .object({
      accountId: id,
      unit: z.string().min(1).max(120),
      attributedPostedUnits: z
        .string()
        .regex(/^(0|-?[1-9][0-9]*)$/)
        .max(80),
      excludedObservationCount: count,
    })
    .nullable(),
});
export type ConnectionUsageSummary = z.infer<typeof ConnectionUsageSummary>;
