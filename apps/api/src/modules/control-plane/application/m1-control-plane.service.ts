import type {
  AdmissionCommand,
  ArtifactCommand,
  ManagementCommand,
  RunnerRegistration,
  UsageCommand,
} from '@ai-runtime/contracts';
import { ApplicationError } from '../../../shared/domain/application-error.js';
import type { Principal } from '../../identity/domain/principal.js';
import { requireAuthority } from '../../identity/domain/principal.js';
import type { M1Repository } from './m1-repository.port.js';

function requireKey(value: string) {
  if (!/^[A-Za-z0-9._:-]{1,160}$/.test(value)) {
    throw new ApplicationError(
      'INVALID_REQUEST',
      'A valid Idempotency-Key is required.',
    );
  }
  return value;
}

function requireUuid(value: string) {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  ) {
    throw new ApplicationError(
      'INVALID_REQUEST',
      'Invalid resource identifier.',
    );
  }
  return value;
}

export class M1ControlPlaneService {
  constructor(private readonly repository: M1Repository) {}

  readSnapshot(principal: Principal) {
    if (principal.kind === 'operator') {
      requireAuthority(principal, 'platform:read');
    } else {
      requireAuthority(principal, 'execution:read');
    }
    return this.repository.readSnapshot(principal);
  }

  manage(principal: Principal, command: ManagementCommand) {
    requireAuthority(principal, 'platform:manage');
    return this.repository.manage(principal, command);
  }

  admit(
    principal: Principal,
    command: AdmissionCommand,
    idempotencyKey: string,
  ) {
    requireAuthority(principal, 'execution:submit');
    return this.repository.admit(
      principal,
      command,
      requireKey(idempotencyKey),
    );
  }
  readExecution(principal: Principal, executionId: string) {
    requireAuthority(principal, 'execution:read');
    return this.repository.readExecution(principal, requireUuid(executionId));
  }

  cancelExecution(
    principal: Principal,
    executionId: string,
    reason: string | null,
  ) {
    requireAuthority(principal, 'execution:cancel');
    if (reason !== null && (reason.length < 1 || reason.length > 500)) {
      throw new ApplicationError(
        'INVALID_REQUEST',
        'Cancel reason must be 1-500 characters.',
      );
    }
    return this.repository.cancelExecution(
      principal,
      requireUuid(executionId),
      reason,
    );
  }

  recordUsage(principal: Principal, command: UsageCommand) {
    requireAuthority(principal, 'usage:verify');
    return this.repository.recordUsage(principal, command);
  }

  registerArtifact(principal: Principal, command: ArtifactCommand) {
    requireAuthority(principal, 'artifact:write');
    return this.repository.registerArtifact(principal, command);
  }

  registerRunner(principal: Principal, command: RunnerRegistration) {
    requireAuthority(principal, 'runner:register');
    return this.repository.registerRunner(principal, command);
  }

  recordInbox(principal: Principal, consumer: string, eventId: string) {
    requireAuthority(principal, 'platform:manage');
    if (!/^[A-Za-z0-9._:-]{1,120}$/.test(consumer)) {
      throw new ApplicationError('INVALID_REQUEST', 'Invalid inbox consumer.');
    }
    return this.repository.recordInbox(
      principal,
      consumer,
      requireUuid(eventId),
    );
  }

  readOutbox(principal: Principal) {
    requireAuthority(principal, 'platform:read');
    return this.repository.readOutbox();
  }

  readAudit(principal: Principal, applicationId?: string) {
    requireAuthority(principal, 'platform:read');
    return this.repository.readAudit(principal, applicationId);
  }
}
