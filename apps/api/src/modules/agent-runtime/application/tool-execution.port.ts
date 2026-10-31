import type { OperationIdentity } from '../domain/operation-identity.js';
import type { AllocationRef } from './budget-authority.port.js';

export const TOOL_EXECUTION = Symbol('AgentToolExecution');

// The Tool owner keeps final authorization and operation truth (ADR-0010).
// Existing ToolEffect semantics are reused through an adapter.

export interface ToolIntent {
  identity: OperationIdentity;
  // Pinned binding from the Definition version; model text cannot widen it.
  bindingId: string;
  operation: string;
  arguments: Readonly<Record<string, unknown>>;
  deadlineMs: number;
  allocation: AllocationRef | null;
}

export interface ToolRef {
  operationId: string;
  receiptId: string | null;
}

export type ToolObservation =
  | { state: 'SUCCEEDED'; ref: ToolRef; result: unknown }
  | { state: 'FAILED'; ref: ToolRef; reason: string }
  // Only the receiver can prove no effect; timeout or 404 cannot.
  | { state: 'NO_EFFECT'; ref: ToolRef; reason: string }
  | { state: 'UNKNOWN'; ref: ToolRef };

export interface ToolExecution {
  invoke(intent: ToolIntent): Promise<ToolObservation>;
  // Receiver-supported, non-dispatching status. Never falls back to invoke().
  status(ref: ToolRef): Promise<ToolObservation>;
}
