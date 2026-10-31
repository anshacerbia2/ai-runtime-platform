import type { OperationIdentity } from '../domain/operation-identity.js';

export const ISOLATED_EXECUTION = Symbol('AgentIsolatedExecution');

// Optional capability (ADR-0034, AR-P07). A Definition that needs code
// execution is refused at admission while no qualified adapter is bound.
// The existing runner/runsc host is a candidate; this port grants it no
// remote-effect or settlement authority.

export interface ComputeRequest {
  identity: OperationIdentity;
  // Approved image or bundle by digest; no caller host paths or sockets.
  imageDigest: string;
  inputDigests: readonly string[];
  deadlineMs: number;
}

export interface ComputeHandle {
  operationId: string;
  assignmentId: string;
  epoch: number;
}

// Local observations only. 'stop_unconfirmed' keeps native ownership
// restrictions in force; it never permits reassignment.
export type ComputeObservation =
  | { state: 'running'; handle: ComputeHandle }
  | { state: 'exited'; handle: ComputeHandle; exitCode: number }
  | { state: 'stopped'; handle: ComputeHandle }
  | { state: 'stop_unconfirmed'; handle: ComputeHandle };

export interface IsolatedExecution {
  acquire(request: ComputeRequest): Promise<ComputeHandle>;
  inspect(handle: ComputeHandle): Promise<ComputeObservation>;
  stop(handle: ComputeHandle, reason: string): Promise<ComputeObservation>;
}
