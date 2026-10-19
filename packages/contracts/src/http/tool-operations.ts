import { initContract } from '@ts-rest/core';
import { z } from 'zod';

const c = initContract();
const digest = z.string().regex(/^[0-9a-f]{64}$/);
const common = {
  operationId: z.uuid(),
  executionId: z.uuid(),
  toolRef: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$/),
  requestDigest: digest,
  receiverRetentionUntil: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
};
const receipt = z.object({
  ref: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,255}$/),
  digest,
});
/** A persisted receiver observation, never an inference from timeout or sandbox exit. */
export const ToolOperationStatus = z.discriminatedUnion('state', [
  z.object({ ...common, state: z.literal('PREPARED'), receipt: z.null() }),
  z.object({ ...common, state: z.literal('DISPATCHING'), receipt: z.null() }),
  z.object({ ...common, state: z.literal('UNKNOWN'), receipt: z.null() }),
  z.object({ ...common, state: z.literal('COMMITTED'), receipt }),
  z.object({ ...common, state: z.literal('NO_EFFECT'), receipt }),
]);
export const ToolOperationQuery = z
  .object({
    limit: z
      .string()
      .regex(/^(?:[1-9]|[1-9][0-9]|100)$/)
      .optional(),
    after: z.uuid().optional(),
  })
  .strict();
export const ToolOperationPage = z.object({
  items: z.array(ToolOperationStatus).max(100),
  nextAfter: z.uuid().nullable(),
  limit: z.number().int().min(1).max(100),
  consistency: z.literal('live-keyset'),
});
const metadata = {
  behavior: { replay: 'read', maxAttempts: 1, maxResponseBytes: 262_144 },
} as const;
export const toolOperationContract = c.router({
  list: {
    method: 'GET',
    path: '/v1/executions/:id/tool-operations',
    pathParams: z.object({ id: z.uuid() }),
    query: ToolOperationQuery,
    metadata,
    responses: { 200: ToolOperationPage },
  },
  status: {
    method: 'GET',
    path: '/v1/executions/:id/tool-operations/:operationId',
    pathParams: z.object({ id: z.uuid(), operationId: z.uuid() }),
    query: z.object({}).strict(),
    metadata,
    responses: { 200: ToolOperationStatus },
  },
});
export type ToolOperationStatus = z.infer<typeof ToolOperationStatus>;
export type ToolOperationQuery = z.infer<typeof ToolOperationQuery>;
export type ToolOperationPage = z.infer<typeof ToolOperationPage>;
