import type {
  RunnerLeaseAck,
  RunnerLeaseCommand,
  RunnerReport,
} from '@ai-runtime/contracts/http';
import { ApplicationError } from '../../../shared/domain/application-error.js';
import type { Principal } from '../../identity/domain/principal.js';
import { requireAuthority } from '../../identity/domain/principal.js';
import type { RunnerLeaseAuthority } from './runner-lease-authority.port.js';
import type {
  RunnerLeaseProof,
  RunnerLeaseStore,
} from './runner-lease-store.port.js';
import type { RunnerLivenessRegistry } from './runner-liveness-registry.port.js';
import type { RunnerPresenceStore } from './runner-presence-store.port.js';
import type { RunnerCoordinationService } from './runner-coordination.service.js';

const LEASE_TTL_MS = 15_000;

export class RunnerLeaseService {
  constructor(
    private readonly registry: RunnerLivenessRegistry,
    private readonly presence: RunnerPresenceStore,
    private readonly leases: RunnerLeaseStore,
    private readonly authority: RunnerLeaseAuthority,
    private readonly coordination?: RunnerCoordinationService,
  ) {}

  private async currentBoot(
    principal: Principal,
    runnerId: string,
    registrationRevision: number,
    bootId: string,
  ) {
    const registration = await this.registry.authorizeHeartbeat(
      principal,
      runnerId,
      registrationRevision,
    );
    let match;
    try {
      match = await this.presence.inspect({ ...registration, bootId });
    } catch {
      throw new ApplicationError(
        'DEPENDENCY_UNAVAILABLE',
        'Runner coordination is unavailable.',
      );
    }
    if (match !== 'CURRENT') {
      throw new ApplicationError(
        'STALE_RUNNER_REGISTRATION',
        'Runner process must publish a current heartbeat.',
      );
    }
  }

  private proof(
    principal: Principal,
    command: RunnerLeaseCommand,
  ): RunnerLeaseProof {
    return {
      assignmentId: command.token.assignmentId,
      executionId: command.token.executionId,
      attemptId: command.token.attemptId,
      runnerId: command.token.runnerId,
      ownerSubject: principal.subject,
      generation: command.token.generation,
      epoch: command.token.epoch,
      nonce: command.nonce,
    };
  }

  async activate(
    principal: Principal,
    command: RunnerLeaseCommand,
  ): Promise<RunnerLeaseAck> {
    requireAuthority(principal, 'runner:report');
    await this.coordination?.assertActive();
    await this.currentBoot(
      principal,
      command.token.runnerId,
      command.registrationRevision,
      command.bootId,
    );
    const status = await this.authority.status(command, principal.subject);
    const proof = this.proof(principal, command);
    let result;
    try {
      result =
        status === 'UNINITIALIZED'
          ? await this.leases.install(proof, LEASE_TTL_MS)
          : await this.leases.renew(proof, LEASE_TTL_MS);
    } catch {
      throw new ApplicationError(
        'DEPENDENCY_UNAVAILABLE',
        'Runner lease coordination is unavailable.',
      );
    }
    if (
      result !== 'INSTALLED' &&
      result !== 'REFRESHED' &&
      result !== 'RENEWED'
    ) {
      throw new ApplicationError(
        'STALE_ASSIGNMENT',
        'Assignment lease is missing or owned by another process.',
      );
    }
    await this.authority.confirm(command, principal.subject);
    await this.currentBoot(
      principal,
      command.token.runnerId,
      command.registrationRevision,
      command.bootId,
    );
    try {
      if ((await this.leases.inspect(proof)) !== 'CURRENT') {
        throw new ApplicationError(
          'STALE_ASSIGNMENT',
          'Assignment lease was lost during activation.',
        );
      }
    } catch (error) {
      if (error instanceof ApplicationError) {
        throw error;
      }
      throw new ApplicationError(
        'DEPENDENCY_UNAVAILABLE',
        'Runner lease coordination is unavailable.',
      );
    }
    await this.coordination?.assertActive();
    return { state: 'ACTIVE', leaseTtlMs: 15_000, renewIntervalMs: 5_000 };
  }

  async validateReport(
    principal: Principal,
    report: RunnerReport,
  ): Promise<void> {
    if (!report.lease) {
      return;
    }
    requireAuthority(principal, 'runner:report');
    await this.coordination?.assertActive();
    const command: RunnerLeaseCommand = {
      ...report.lease,
      token: report.token,
    };
    await this.currentBoot(
      principal,
      command.token.runnerId,
      command.registrationRevision,
      command.bootId,
    );
    try {
      if (
        (await this.leases.inspect(this.proof(principal, command))) !==
        'CURRENT'
      ) {
        throw new ApplicationError(
          'STALE_ASSIGNMENT',
          'Assignment lease is not current.',
        );
      }
    } catch (error) {
      if (error instanceof ApplicationError) {
        throw error;
      }
      throw new ApplicationError(
        'DEPENDENCY_UNAVAILABLE',
        'Runner lease coordination is unavailable.',
      );
    }
  }
}
