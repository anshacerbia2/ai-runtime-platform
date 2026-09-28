export const RUNNER_LEASE_STORE = Symbol('RUNNER_LEASE_STORE');

export interface RunnerLeaseProof {
  assignmentId: string;
  executionId: string;
  attemptId: string;
  runnerId: string;
  ownerSubject: string;
  generation: number;
  epoch: number;
  nonce: string;
}

export type RunnerLeaseInstallResult = 'INSTALLED' | 'REFRESHED' | 'CONFLICT';
export type RunnerLeaseMatchResult = 'CURRENT' | 'MISSING' | 'MISMATCH';
export type RunnerLeaseRenewResult = 'RENEWED' | 'MISSING' | 'MISMATCH';
export type RunnerLeaseReleaseResult = 'RELEASED' | 'MISSING' | 'MISMATCH';

/** Redis is short-lived proof only; PostgreSQL remains assignment authority. */
export interface RunnerLeaseStore {
  install(
    proof: RunnerLeaseProof,
    ttlMs: number,
  ): Promise<RunnerLeaseInstallResult>;
  inspect(proof: RunnerLeaseProof): Promise<RunnerLeaseMatchResult>;
  renew(
    proof: RunnerLeaseProof,
    ttlMs: number,
  ): Promise<RunnerLeaseRenewResult>;
  release(proof: RunnerLeaseProof): Promise<RunnerLeaseReleaseResult>;
}
