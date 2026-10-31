import { initContract } from '@ts-rest/core';
import { z } from 'zod';

const c = initContract();

// Agent preview (ADR-0034 stage A2-preview). A run lives for one request:
// it is streamed, not persisted, and cannot be resumed. Each model step is a
// separately admitted and accounted gateway execution.
export const agentToolNames = [
  'current_time',
  'calculate',
  'execution_lookup',
] as const;
export const AgentToolName = z.enum(agentToolNames);

export const agentRunLimits = Object.freeze({
  maxSteps: 8,
  defaultSteps: 6,
  defaultOutputTokens: 1024,
  defaultTokenBudget: 50_000,
  maxTokenBudget: 200_000,
});

const text = (max: number) => z.string().min(1).max(max);

export const AgentRunRequest = z
  .object({
    profile: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$/),
    input: text(20_000).refine((value) => value.trim().length > 0, {
      message: 'Input must not be blank.',
    }),
    system: z.string().max(8_000).optional(),
    history: z
      .array(
        z
          .object({
            role: z.enum(['user', 'assistant']),
            text: text(20_000),
          })
          .strict(),
      )
      .max(40)
      .optional(),
    tools: z.array(AgentToolName).max(agentToolNames.length).optional(),
    max_steps: z.number().int().min(1).max(agentRunLimits.maxSteps).optional(),
    max_output_tokens: z.number().int().min(64).max(8_192).optional(),
    token_budget: z
      .number()
      .int()
      .min(1_000)
      .max(agentRunLimits.maxTokenBudget)
      .optional(),
  })
  .strict();

const tokens = z.number().int().nonnegative().nullable();
const totals = {
  steps: z.number().int().nonnegative(),
  input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
};
const base = {
  schema_version: z.literal('1'),
  run_id: z.uuid(),
  sequence: z.number().int().nonnegative(),
  occurred_at: z.iso.datetime({ offset: true }),
};
const step = z.number().int().positive();

export const AgentRunEvent = z.discriminatedUnion('type', [
  z.object({
    ...base,
    type: z.literal('run.started'),
    payload: z.object({
      profile: z.string(),
      tools: z.array(AgentToolName),
      max_steps: z.number().int().positive(),
      token_budget: z.number().int().positive(),
    }),
  }),
  z.object({
    ...base,
    type: z.literal('model.dispatched'),
    payload: z.object({ step, execution_id: z.uuid() }),
  }),
  z.object({
    ...base,
    type: z.literal('model.completed'),
    payload: z.object({
      step,
      execution_id: z.uuid().nullable(),
      input_tokens: tokens,
      output_tokens: tokens,
      thought: z.string().nullable(),
      action: z.enum(['tool', 'final']),
    }),
  }),
  z.object({
    ...base,
    type: z.literal('tool.called'),
    payload: z.object({
      step,
      tool: z.string().max(80),
      arguments: z.record(z.string(), z.unknown()),
    }),
  }),
  z.object({
    ...base,
    type: z.literal('tool.completed'),
    payload: z.object({
      step,
      tool: z.string().max(80),
      status: z.enum(['SUCCEEDED', 'FAILED']),
      output: z.string().max(8_000),
    }),
  }),
  z.object({
    ...base,
    type: z.literal('run.completed'),
    payload: z.object({ answer: z.string(), ...totals }),
  }),
  z.object({
    ...base,
    type: z.literal('run.stopped'),
    payload: z.object({
      status: z.enum(['FAILED', 'CANCELLED', 'STOPPED_BUDGET']),
      code: z.string().min(1).max(120),
      message: z.string().max(1_000),
      ...totals,
    }),
  }),
]);

const routes = {
  run: {
    method: 'POST',
    path: '/v1/agent/runs',
    body: AgentRunRequest,
    // Not replayable: a run is a fresh sequence of admitted model steps.
    metadata: { responseMode: 'sse', sse: true },
    responses: { 200: z.string() },
  },
} as const;

export const agentContract = c.router(routes);
export const browserAgentContract = c.router({
  run: { ...routes.run, path: '/api/v1/agent/runs' },
});

export type AgentToolName = z.infer<typeof AgentToolName>;
export type AgentRunRequest = z.infer<typeof AgentRunRequest>;
export type AgentRunEvent = z.infer<typeof AgentRunEvent>;
