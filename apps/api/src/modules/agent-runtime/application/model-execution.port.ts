import type { OperationIdentity, Units } from '../domain/operation-identity.js';
import type { AllocationRef } from './budget-authority.port.js';

export const MODEL_EXECUTION = Symbol('AgentModelExecution');

// Model & Inference capabilities an Agent Turn may request. Provider, model and
// credential are chosen by the Capability Profile on the Model & Inference
// side; the agent never names them (ADR-0034, AR-P04).
export type ModelCapability = 'chat' | 'generate' | 'structured_generate';

export interface ModelMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ModelIntent {
  identity: OperationIdentity;
  capabilityProfile: string;
  capability: ModelCapability;
  messages: readonly ModelMessage[];
  responseSchema?: Readonly<Record<string, unknown>>;
  maxOutputTokens?: number;
  deadlineMs: number;
  // Bound allocation from the whole-run reservation. A chargeable intent
  // without one must be refused; it can never fall back to a fresh admission.
  allocation: AllocationRef;
}

// Retained identity for later status reads. Model & Inference owns the
// inference record; the agent keeps only this reference.
export interface InferenceRef {
  operationId: string;
  inferenceId: string | null;
}

export interface ModelUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  charged: Units | null;
  completeness: 'complete' | 'unknown';
}

export type ModelObservation =
  | {
      state: 'SUCCEEDED';
      ref: InferenceRef;
      output: string;
      usage: ModelUsage;
    }
  | { state: 'FAILED'; ref: InferenceRef; reason: string; usage: ModelUsage }
  // Only Model & Inference can prove nothing was sent.
  | { state: 'NO_EFFECT'; ref: InferenceRef; reason: string }
  | { state: 'UNKNOWN'; ref: InferenceRef };

export interface ModelExecuteOptions {
  // Run cancellation. The adapter turns it into a best-effort cancel of the
  // in-flight inference; it never proves that nothing was charged.
  signal?: AbortSignal;
  // Called once Model & Inference has accepted the intent and named it.
  onDispatched?: (ref: InferenceRef) => void;
}

export interface ModelExecution {
  // Dispatch one authorized intent. Call only after winning the dispatch CAS.
  // A missing reply leaves the operation ambiguous; it is not a rejection.
  execute(
    intent: ModelIntent,
    options?: ModelExecuteOptions,
  ): Promise<ModelObservation>;

  // Non-dispatching status read under the original identity. Its absence or
  // error must never trigger execute() as a fallback.
  status(ref: InferenceRef): Promise<ModelObservation>;

  // Best effort. Cancelling cannot erase charges or prove no effect.
  cancel(ref: InferenceRef, reason: string | null): Promise<void>;
}
