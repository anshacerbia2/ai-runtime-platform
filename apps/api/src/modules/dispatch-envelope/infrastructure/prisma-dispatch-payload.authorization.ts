import type { RunnerLeaseCommand } from '@ai-runtime/contracts/http';
import type { DatabaseService } from '../../../infrastructure/database/database.service.js';
import { ApplicationError } from '../../../shared/domain/application-error.js';
import { RunnerLeaseService } from '../../control-plane/application/runner-lease.service.js';
import type { Principal } from '../../identity/domain/principal.js';
import type { DispatchPayloadAuthorization } from '../application/dispatch-envelope.ports.js';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Live lease plus durable assignment/envelope binding, checked on both sides of decrypt. */
export class PrismaDispatchPayloadAuthorization implements DispatchPayloadAuthorization {
  constructor(
    private readonly database: DatabaseService,
    private readonly leases: RunnerLeaseService,
  ) {}

  async assertCurrent(
    principal: Principal,
    command: RunnerLeaseCommand,
    envelopeId: string,
  ): Promise<{ applicationId: string }> {
    const token = command.token;
    if (
      !UUID.test(envelopeId) ||
      !UUID.test(token.assignmentId) ||
      !UUID.test(token.executionId) ||
      !UUID.test(token.attemptId) ||
      !UUID.test(command.bootId)
    ) {
      throw new ApplicationError(
        'INVALID_REQUEST',
        'Invalid payload identity.',
      );
    }
    await this.leases.validateReport(principal, {
      type: 'started',
      token,
      lease: {
        bootId: command.bootId,
        registrationRevision: command.registrationRevision,
        nonce: command.nonce,
      },
    });
    const rows = await this.database.$queryRaw<
      Array<{ applicationId: string }>
    >`
      SELECT e.application_id AS "applicationId"
      FROM control.runner_assignments a
      JOIN control.executions e ON e.id = a.execution_id
      JOIN control.attempts t ON t.id = a.attempt_id AND t.execution_id = e.id
      JOIN control.dispatch_envelopes d
        ON d.execution_id = e.id AND d.application_id = e.application_id
      WHERE a.id = ${token.assignmentId}::uuid
        AND a.execution_id = ${token.executionId}::uuid
        AND a.attempt_id = ${token.attemptId}::uuid
        AND a.runner_id = ${token.runnerId}
        AND a.owner_subject = ${principal.subject}
        AND a.claim_boot_id = ${command.bootId}::uuid
        AND a.generation = ${token.generation}
        AND a.epoch = ${token.epoch}
        AND a.state IN ('GRANTED', 'STARTED')
        AND e.admission_source = 'AGENT'
        AND e.status IN ('ACCEPTED', 'RUNNING')
        AND e.cancel_requested_at IS NULL
        AND e.assignment_generation = a.generation
        AND e.coordination_epoch = a.epoch
        AND t.status IN ('PREPARED', 'RUNNING')
        AND t.authority = 'OWNED'
        AND d.id = ${envelopeId}::uuid
        AND d.execution_binding_id = e.id
        AND d.profile_revision_id = e.profile_revision_id
        AND d.state = 'COMMITTED'::control."DispatchEnvelopeState"
        AND d.expires_at > clock_timestamp()`;
    if (rows.length !== 1) {
      throw new ApplicationError(
        'STALE_ASSIGNMENT',
        'Runner payload grant is no longer current.',
      );
    }
    return rows[0]!;
  }
}
