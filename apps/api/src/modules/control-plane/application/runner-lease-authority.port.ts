import type { RunnerLeaseCommand } from '@ai-runtime/contracts/http';

export const RUNNER_LEASE_AUTHORITY = Symbol('RUNNER_LEASE_AUTHORITY');

export type RunnerLeaseStatus = 'UNINITIALIZED' | 'CURRENT';

export interface RunnerLeaseAuthority {
  status(
    command: RunnerLeaseCommand,
    ownerSubject: string,
  ): Promise<RunnerLeaseStatus>;
  confirm(command: RunnerLeaseCommand, ownerSubject: string): Promise<void>;
}
