import { z } from 'zod';
import { id, Capability } from './requests.js';

export const Profile = z.strictObject({
  profile: id,
  capability: Capability,
  workload_class: z.enum(['interactive', 'batch', 'agent']),
  execution_path: z.enum(['gateway', 'agent']),
  runtime_adapter: z.enum(['claude', 'codex', 'gemini']).nullable(),
  provider_adapter: z.enum(['openrouter', 'direct-anthropic']).nullable(),
  harness_ref: id.nullable(),
  limits: z.strictObject({
    max_output_tokens: z.number().int().positive(),
    timeout_ms: z.number().int().positive(),
  }),
  streaming: z.boolean(),
  mode: z.literal('contract-only'),
  title: z.string(),
  description: z.string(),
});

export type ProfileType = z.infer<typeof Profile>;

export const ExecutionProfile = z.strictObject({
  profile: id,
  capability: Capability,
  runtime: z
    .strictObject({
      adapter: z.enum(['claude', 'codex', 'gemini']),
      version_policy: id,
    })
    .optional(),
  model_policy_ref: id,
  credential_binding_ref: id,
  harness_ref: id.optional(),
  tool_policy_ref: id.optional(),
  data_policy_ref: id,
  limits: z.strictObject({
    max_attempts: z.number().int().min(1),
    max_turns: z.number().int().min(1),
    max_concurrency: z.number().int().min(1),
  }),
  budget_policy_ref: id,
  session_policy: z.enum(['none', 'same-runtime-single-writer']),
  workload_class: z.enum(['interactive', 'batch', 'agent']),
});

export const AdapterDescriptor = z.strictObject({
  adapter_id: id,
  kind: z.enum(['provider', 'runtime']),
  version: id,
  capabilities: z.array(Capability),
  supports_streaming: z.boolean(),
  supports_cancellation: z.boolean(),
  supports_sessions: z.boolean(),
  usage_granularity: z.enum(['invocation', 'summary', 'unknown']),
  enforced_limits: z.array(
    z.enum(['output_tokens', 'turns', 'duration', 'concurrency']),
  ),
  status: z.enum(['PLANNED', 'TEST_ONLY', 'VERIFIED_FOR_PROFILE']),
});
