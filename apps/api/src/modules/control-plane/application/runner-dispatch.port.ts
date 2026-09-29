import type { RunnerDispatchGrant } from '@ai-runtime/contracts/http';
import type { RunnerRegistrationIdentity } from './runner-liveness-registry.port.js';

export const RUNNER_DISPATCH_REPOSITORY = Symbol('RUNNER_DISPATCH_REPOSITORY');

export interface RunnerDispatchRepository {
  claim(
    registration: RunnerRegistrationIdentity,
    bootId: string,
  ): Promise<RunnerDispatchGrant | null>;
}
