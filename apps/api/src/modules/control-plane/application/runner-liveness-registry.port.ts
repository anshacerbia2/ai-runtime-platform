import type { Principal } from '../../identity/domain/principal.js';

export const RUNNER_LIVENESS_REGISTRY = Symbol('RUNNER_LIVENESS_REGISTRY');

export interface RunnerRegistrationIdentity {
  runnerId: string;
  ownerSubject: string;
  registrationRevision: number;
}

export interface RunnerLivenessRegistry {
  authorizeHeartbeat(
    principal: Principal,
    runnerId: string,
    registrationRevision: number,
  ): Promise<RunnerRegistrationIdentity>;
}
