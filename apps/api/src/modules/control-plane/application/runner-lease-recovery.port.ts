import type { RunnerLeaseDurableProof } from './runner-lease-store.port.js';

export const RUNNER_LEASE_RECOVERY = Symbol('RUNNER_LEASE_RECOVERY');

export interface RunnerLeaseRecoveryCandidate {
  assignmentId: string;
  executionId: string;
  proof: RunnerLeaseDurableProof | null;
}

export interface RunnerLeaseRecovery {
  scan(
    afterId: string | null,
    limit: number,
  ): Promise<RunnerLeaseRecoveryCandidate[]>;
  fence(
    candidate: RunnerLeaseRecoveryCandidate,
    reason: 'ACTIVATION_TIMEOUT' | 'LEASE_MISSING' | 'LEASE_MISMATCH',
  ): Promise<boolean>;
}
