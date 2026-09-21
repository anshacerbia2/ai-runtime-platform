import { z } from 'zod';

export const id = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:@/-]*$/);

const text = z.string().min(1).max(24000);

export const Context = z.strictObject({
  process_id: id.optional(),
  step_id: id.optional(),
  conversation_id: id.optional(),
  parent_execution_id: id.optional(),
  labels: z.record(z.string().max(40), z.string().max(160)).optional(),
});

export const Constraints = z.strictObject({
  max_output_tokens: z.number().int().min(1).max(32768).optional(),
  timeout_ms: z.number().int().min(1).max(3600000).optional(),
});

export const Capability = z.enum([
  'chat',
  'generate',
  'structured_generate',
  'agent_execute',
]);

export const Content = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('text'), text }),
  z.strictObject({ type: z.literal('artifact'), artifact_ref: id }),
]);

export const ChatInput = z.strictObject({
  messages: z
    .array(
      z.strictObject({
        role: z.enum(['system', 'user', 'assistant']),
        content: z.array(Content).min(1).max(16),
      }),
    )
    .min(1)
    .max(64),
});

export const PromptInput = z.strictObject({
  prompt: text,
  artifact_refs: z.array(id).max(16).optional(),
});
// The caller's schema is DATA, never compiled as executable code. M0 checks a bounded subset below.
export const StructuredInput = PromptInput.extend({
  response_schema: z.record(z.string(), z.unknown()),
});

const common = {
  profile: id,
  context: Context.optional(),
  constraints: Constraints.optional(),
  session_ref: id.optional(),
};

export const ChatRequest = z.strictObject({
  ...common,
  input: ChatInput,
  stream: z.boolean().optional(),
});

export const GenerateRequest = z.discriminatedUnion('capability', [
  z.strictObject({
    ...common,
    capability: z.literal('generate'),
    input: PromptInput,
    stream: z.boolean().optional(),
  }),
  z.strictObject({
    ...common,
    capability: z.literal('structured_generate'),
    input: StructuredInput,
    stream: z.boolean().optional(),
  }),
]);

export const ExecutionRequest = z.discriminatedUnion('capability', [
  z.strictObject({
    ...common,
    capability: z.literal('chat'),
    input: ChatInput,
  }),
  z.strictObject({
    ...common,
    capability: z.literal('generate'),
    input: PromptInput,
  }),
  z.strictObject({
    ...common,
    capability: z.literal('structured_generate'),
    input: StructuredInput,
  }),
  z.strictObject({
    ...common,
    capability: z.literal('agent_execute'),
    input: PromptInput,
  }),
]);
