import type {
  OperationIdentity,
  TrustedCaller,
  Units,
} from '../domain/operation-identity.js';

export const BUDGET_AUTHORITY = Symbol('AgentBudgetAuthority');

// Accounting stays the single ledger authority (ADR-0007). Agent Runtime holds
// references only and never writes financial tables (ADR-0034, AR-P05).

export interface RunReservationRef {
  reservationId: string;
  runId: string;
}

// One bound subdivision of a Run's existing hold. It creates no additional
// account hold.
export interface AllocationRef {
  allocationId: string;
  reservationId: string;
  operationId: string;
}

export interface ReserveRunCommand {
  runId: string;
  caller: TrustedCaller;
  // Same key returns the same reservation; a changed digest conflicts.
  submissionKey: string;
  requestDigest: string;
  envelope: Units;
}

export interface AllocateOperationCommand {
  reservation: RunReservationRef;
  identity: OperationIdentity;
  ceiling: Units;
}

export interface AllocationView {
  ref: AllocationRef;
  ceiling: Units;
  // Null while any usage is unknown or in flight; unknown is never zero.
  consumed: Units | null;
  state: 'ACTIVE' | 'BLOCKED_OVERAGE' | 'RELEASED';
}

export interface BudgetAuthority {
  reserveRun(command: ReserveRunCommand): Promise<RunReservationRef>;
  // Idempotent per operation; changed amount, unit or digest conflicts.
  allocateOperation(command: AllocateOperationCommand): Promise<AllocationRef>;
  readAllocation(ref: AllocationRef): Promise<AllocationView>;
  // Returns unused allowance only after an authorized no-further-dispatch
  // transition. Unresolved exposure stays held.
  releaseOperation(ref: AllocationRef, reason: string): Promise<void>;
  releaseRun(ref: RunReservationRef, reason: string): Promise<void>;
}
