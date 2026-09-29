import type { RunnerRegistrationIdentity } from './runner-liveness-registry.port.js';

export const RUNNER_PRESENCE_STORE = Symbol('RUNNER_PRESENCE_STORE');

export interface RunnerPresenceProof extends RunnerRegistrationIdentity {
  bootId: string;
}

export type RunnerPresenceMatch = 'CURRENT' | 'MISSING' | 'MISMATCH';

/** Hot liveness projection only; it cannot grant assignment authority. */
export interface RunnerPresenceStore {
  heartbeat(proof: RunnerPresenceProof, ttlMs: number): Promise<void>;
  inspect(
    registration: RunnerRegistrationIdentity | RunnerPresenceProof,
  ): Promise<RunnerPresenceMatch>;
}
