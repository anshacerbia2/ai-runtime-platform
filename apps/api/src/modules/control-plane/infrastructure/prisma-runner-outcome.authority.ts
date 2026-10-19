import { createHash, randomUUID } from 'node:crypto';
import { canonicalJson } from '@ai-runtime/contracts';
import type {
  RunnerOutcomeBinding,
  RunnerStopReport,
  RunnerStopReceipt,
  RunnerResultReconciliationRequest,
  RunnerResultReconciliation,
} from '@ai-runtime/contracts/http';
import type { Prisma } from '../../../infrastructure/database/generated/client.js';
import type { DatabaseService } from '../../../infrastructure/database/database.service.js';
import { ApplicationError } from '../../../shared/domain/application-error.js';
import type { Principal } from '../../identity/domain/principal.js';
import type { RunnerOutcomeAuthority } from '../application/runner-outcome.port.js';

const hash = (value: unknown) =>
  createHash('sha256').update(canonicalJson(value)).digest('hex');

export class PrismaRunnerOutcomeAuthority implements RunnerOutcomeAuthority {
  constructor(private readonly db: DatabaseService) {}

  private transaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>) {
    return this.db.$transaction(work, {
      isolationLevel: 'ReadCommitted',
      maxWait: 2000,
      timeout: 5000,
    });
  }

  private async original(
    tx: Prisma.TransactionClient,
    principal: Principal,
    binding: RunnerOutcomeBinding,
  ) {
    // Existing report/fence/finalization paths take execution FOR UPDATE. This is
    // one consistent observation; it neither renews nor changes their authority.
    await tx.$queryRaw`SELECT id FROM control.executions WHERE id=${binding.token.executionId}::uuid FOR SHARE`;
    const execution = await tx.execution.findUnique({
      where: { id: binding.token.executionId },
    });
    const row = await tx.runnerAssignment.findUnique({
      where: { id: binding.token.assignmentId },
    });
    if (
      !execution ||
      !row ||
      row.executionId !== binding.token.executionId ||
      row.attemptId !== binding.token.attemptId ||
      row.runnerId !== binding.token.runnerId ||
      row.ownerSubject !== principal.subject ||
      row.generation !== binding.token.generation ||
      row.epoch !== binding.token.epoch ||
      execution.admissionSource !== 'AGENT' ||
      row.claimBootId !== binding.bootId ||
      row.claimRegistrationRevision === null ||
      row.claimRegistrationRevision !== binding.registrationRevision
    ) {
      throw new ApplicationError(
        'STALE_ASSIGNMENT',
        'Original runner process binding is not proven.',
      );
    }
    const stale =
      execution.assignmentGeneration !== row.generation ||
      execution.coordinationEpoch !== row.epoch ||
      row.state === 'FENCED' ||
      execution.cancelRequestedAt !== null ||
      !['ACCEPTED', 'RUNNING'].includes(execution.status);
    return { row, execution, stale };
  }

  stop(
    principal: Principal,
    report: RunnerStopReport,
  ): Promise<RunnerStopReceipt> {
    return this.transaction(async (tx) => {
      const { evidence, ...binding } = report;
      const { row, execution, stale } = await this.original(
        tx,
        principal,
        binding,
      );
      const digest = hash(report);
      const id = randomUUID();
      const inserted = await tx.runnerStopReceipt.createMany({
        data: [
          {
            id,
            assignmentId: row.id,
            executionId: row.executionId,
            attemptId: row.attemptId,
            bootId: binding.bootId,
            registrationRevision: binding.registrationRevision,
            evidenceState: evidence.state,
            terminationMethod: evidence.method,
            digest,
            state: 'QUARANTINED',
          },
        ],
        skipDuplicates: true,
      });
      const stored = await tx.runnerStopReceipt.findUniqueOrThrow({
        where: {
          assignmentId_bootId_registrationRevision: {
            assignmentId: row.id,
            bootId: binding.bootId,
            registrationRevision: binding.registrationRevision,
          },
        },
      });
      if (stored.digest !== digest) {
        throw new ApplicationError(
          'IDEMPOTENCY_CONFLICT',
          'Stop observation identity contains conflicting content.',
        );
      }
      if (inserted.count === 1) {
        await tx.auditEntry.create({
          data: {
            id: randomUUID(),
            applicationId: execution.applicationId,
            actor: principal.subject,
            action: 'runner.stop-evidence-quarantined',
            resourceId: id,
            revision: 1,
          },
        });
        await tx.outboxEvent.create({
          data: {
            id: randomUUID(),
            applicationId: execution.applicationId,
            topic: 'runner.stop-evidence-received',
            aggregateId: id,
            revision: 1,
            payload: {
              assignment_id: row.id,
              execution_id: row.executionId,
              attempt_id: row.attemptId,
              boot_id: binding.bootId,
              registration_revision: binding.registrationRevision,
              state: 'QUARANTINED',
              evidence_state: evidence.state,
            },
          },
        });
      }
      return {
        id: stored.id,
        binding,
        evidence,
        state: 'QUARANTINED',
        replayed: inserted.count === 0,
        stale,
      };
    });
  }

  reconcileResult(
    principal: Principal,
    request: RunnerResultReconciliationRequest,
  ): Promise<RunnerResultReconciliation> {
    return this.transaction(async (tx) => {
      const { proposalDigest, ...binding } = request;
      const { row, stale } = await this.original(tx, principal, binding);
      const state =
        row.proposalDigest === null
          ? 'NOT_RECORDED'
          : row.proposalDigest.trim() === proposalDigest
            ? 'MATCHED'
            : 'CONFLICT';
      // A match can survive fencing/cancel and says only that this proposal committed.
      return { binding, proposalDigest, state, stale };
    });
  }
}
