import { initContract } from '@ts-rest/core';
import { z } from 'zod';
import {
  ChatRequest,
  GenerateRequest,
  ExecutionRequest,
  CancelRequest,
} from '../index.js';

const c = initContract();
const requestKey = z.object({
  'idempotency-key': z.string().regex(/^[A-Za-z0-9._:-]{1,160}$/),
});
const executionId = z.object({ id: z.uuid() });
const streamHeaders = z
  .object({ 'last-event-id': z.string().max(512).optional() })
  .partial();

export const GatewayUsage = z.object({
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  totalTokens: z.number().int().nonnegative().nullable(),
  completeness: z.enum(['complete', 'unknown']),
});
export const GatewayResult = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), text: z.string() }),
  z.object({ kind: z.literal('structured'), value: z.unknown() }),
]);

export const GatewayExecution = z.object({
  executionId: z.uuid(),
  status: z.enum([
    'RUNNING',
    'COMPLETED',
    'FAILED',
    'RECONCILING',
    'CANCELLED',
  ]),
  replayed: z.boolean(),
  provider: z.enum(['openrouter', 'direct-anthropic']),
  model: z.string().min(1).max(200),
  result: GatewayResult.nullable(),
  usage: GatewayUsage,
  requestId: z.string().nullable(),
  finishReason: z.string().nullable(),
  links: z.object({
    self: z.string(),
    events: z.string(),
  }),
});

export const GatewayStreamEvent = z.object({
  schema_version: z.literal('1'),
  id: z.string().min(1).max(200),
  execution_id: z.uuid(),
  sequence: z.number().int().nonnegative(),
  type: z.enum([
    'execution.started',
    'model.delta',
    'usage.updated',
    'execution.completed',
    'execution.failed',
    'execution.cancelled',
    'stream.reset_required',
  ]),
  occurred_at: z.iso.datetime({ offset: true }),
  payload: z.record(z.string(), z.unknown()),
});

const mutationBehavior = {
  replay: 'same-key',
  maxAttempts: 3,
  retryOwner: 'client',
  fingerprint: 'sha256-canonical-execution-request-v1',
  maxResponseBytes: 2_097_152,
} as const;
const streamMetadata = {
  responseMode: 'json-or-sse',
  sse: true,
  behavior: mutationBehavior,
} as const;

const routes = {
  chat: {
    method: 'POST',
    path: '/v1/chat',
    headers: requestKey,
    body: ChatRequest,
    metadata: streamMetadata,
    responses: { 200: GatewayExecution },
  },
  generate: {
    method: 'POST',
    path: '/v1/generate',
    headers: requestKey,
    body: GenerateRequest,
    metadata: streamMetadata,
    responses: { 200: GatewayExecution },
  },
  submit: {
    method: 'POST',
    path: '/v1/executions',
    headers: requestKey,
    body: ExecutionRequest,
    metadata: { behavior: mutationBehavior },
    responses: { 200: GatewayExecution },
  },
  execution: {
    method: 'GET',
    path: '/v1/executions/:id',
    pathParams: executionId,
    responses: { 200: GatewayExecution },
  },
  cancel: {
    method: 'POST',
    path: '/v1/executions/:id/cancel',
    pathParams: executionId,
    body: CancelRequest,
    responses: { 200: GatewayExecution },
  },
  events: {
    method: 'GET',
    path: '/v1/executions/:id/events',
    pathParams: executionId,
    headers: streamHeaders,
    metadata: { responseMode: 'sse', sse: true },
    responses: { 200: z.string() },
  },
} as const;

export const gatewayContract = c.router(routes);
export const browserGatewayContract = c.router({
  chat: { ...routes.chat, path: '/api/v1/chat' },
  generate: { ...routes.generate, path: '/api/v1/generate' },
  submit: { ...routes.submit, path: '/api/v1/executions' },
  execution: { ...routes.execution, path: '/api/v1/executions/:id' },
  cancel: { ...routes.cancel, path: '/api/v1/executions/:id/cancel' },
  events: { ...routes.events, path: '/api/v1/executions/:id/events' },
});

export type GatewayExecution = z.infer<typeof GatewayExecution>;
export type GatewayStreamEvent = z.infer<typeof GatewayStreamEvent>;
export type GatewayResult = z.infer<typeof GatewayResult>;
export type GatewayUsage = z.infer<typeof GatewayUsage>;
