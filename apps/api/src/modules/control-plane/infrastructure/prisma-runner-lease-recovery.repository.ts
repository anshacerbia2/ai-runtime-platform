import { randomUUID } from 'node:crypto';
import type { DatabaseService } from '../../../infrastructure/database/database.service.js';
import type {
  RunnerLeaseRecovery,
  RunnerLeaseRecoveryCandidate,
} from '../application/runner-lease-recovery.port.js';

interface CandidateRow {
  assignmentId: string;
  executionId: string;
  attemptId: string;
  runnerId: string;
  ownerSubject: string;
  generation: number;
  epoch: number;
  nonceDigest: string | null;
}

export class PrismaRunnerLeaseRecoveryRepository implements RunnerLeaseRecovery {
  constructor(private readonly db: DatabaseService) {}

  async scan(
    afterId: string | null,
    limit: number,
  ): Promise<RunnerLeaseRecoveryCandidate[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 64) {
      throw new Error('Runner lease recovery scan limit must be 1-64.');
    }
    const rows = await this.db.$queryRaw<CandidateRow[]>`
      SELECT a.id AS "assignmentId",
             a.execution_id AS "executionId",
             a.attempt_id AS "attemptId",
             a.runner_id AS "runnerId",
             a.owner_subject AS "ownerSubject",
             a.generation,
             a.epoch,
             a.lease_nonce_digest AS "nonceDigest"
      FROM control.runner_assignments a
      JOIN control.executions e ON e.id = a.execution_id
      WHERE a.id > ${afterId ?? '00000000-0000-0000-0000-000000000000'}::uuid
        AND a.claim_boot_id IS NOT NULL
        AND a.state IN ('GRANTED', 'STARTED')
        AND e.admission_source = 'AGENT'
        AND e.status IN ('ACCEPTED', 'RUNNING')
        AND e.assignment_generation = a.generation
        AND e.coordination_epoch = a.epoch
        AND (
          (a.lease_nonce_digest IS NULL
            AND a.updated_at < clock_timestamp() - interval '30 seconds')
          OR
          (a.lease_nonce_digest IS NOT NULL
            AND a.updated_at < clock_timestamp() - interval '15 seconds')
        )
      ORDER BY a.id
      LIMIT ${limit}`;
    return rows.map((row) => ({
      assignmentId: row.assignmentId,
      executionId: row.executionId,
      proof: row.nonceDigest
        ? {
            assignmentId: row.assignmentId,
            executionId: row.executionId,
            attemptId: row.attemptId,
            runnerId: row.runnerId,
            ownerSubject: row.ownerSubject,
            generation: row.generation,
            epoch: row.epoch,
            nonceDigest: row.nonceDigest.trim(),
          }
        : null,
    }));
  }

  async fence(
    candidate: RunnerLeaseRecoveryCandidate,
    reason: 'ACTIVATION_TIMEOUT' | 'LEASE_MISSING' | 'LEASE_MISMATCH',
  ): Promise<boolean> {
    return this.db.$transaction(
      async (tx) => {
        const locked = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM control.executions
          WHERE id = ${candidate.executionId}::uuid
          FOR UPDATE SKIP LOCKED`;
        if (locked.length === 0) {
          return false;
        }
        const execution = await tx.execution.findUnique({
          where: { id: candidate.executionId },
        });
        const row = await tx.runnerAssignment.findUnique({
          where: { id: candidate.assignmentId },
          include: { attempt: true },
        });
        if (
          !execution ||
          !row ||
          execution.admissionSource !== 'AGENT' ||
          !['ACCEPTED', 'RUNNING'].includes(execution.status) ||
          !['GRANTED', 'STARTED'].includes(row.state) ||
          row.claimBootId === null ||
          row.executionId !== execution.id ||
          row.generation !== execution.assignmentGeneration ||
          row.epoch !== execution.coordinationEpoch ||
          (candidate.proof === null
            ? row.leaseNonceDigest !== null || reason !== 'ACTIVATION_TIMEOUT'
            : row.leaseNonceDigest?.trim() !== candidate.proof.nonceDigest ||
              row.attemptId !== candidate.proof.attemptId ||
              row.runnerId !== candidate.proof.runnerId ||
              row.ownerSubject !== candidate.proof.ownerSubject ||
              row.generation !== candidate.proof.generation ||
              row.epoch !== candidate.proof.epoch ||
              reason === 'ACTIVATION_TIMEOUT')
        ) {
          return false;
        }
        await tx.runnerAssignment.update({
          where: { id: row.id },
          data: { state: 'FENCED' },
        });
        await tx.attempt.update({
          where: { id: row.attemptId },
          data: {
            status: 'ORPHAN_SUSPENDED',
            authority: 'FENCED',
            compute: row.state === 'STARTED' ? 'UNKNOWN' : row.attempt.compute,
            external:
              row.state === 'STARTED' &&
              ['NONE', 'IN_FLIGHT'].includes(row.attempt.external)
                ? 'UNKNOWN'
                : row.attempt.external,
          },
        });
        await tx.execution.update({
          where: { id: execution.id },
          data: {
            status: 'RECONCILING',
            statusReason: `RUNNER_${reason}`,
            assignmentGeneration:
              execution.assignmentGeneration < 2_147_483_646
                ? { increment: 1 }
                : execution.assignmentGeneration,
            revision: { increment: 1 },
          },
        });
        await tx.reservation.updateMany({
          where: { executionId: execution.id, state: 'RESERVED' },
          data: {
            state: 'PENDING_RECONCILIATION',
            revision: { increment: 1 },
          },
        });
        await tx.auditEntry.create({
          data: {
            id: randomUUID(),
            applicationId: execution.applicationId,
            actor: 'system:runner-lease-reaper',
            action: 'runner.assignment-orphan-suspended',
            resourceId: execution.id,
            revision: execution.revision + 1,
          },
        });
        await tx.outboxEvent.create({
          data: {
            id: randomUUID(),
            applicationId: execution.applicationId,
            topic: 'runner.assignment-orphan-suspended',
            aggregateId: row.id,
            revision: 1,
            payload: {
              assignment_id: row.id,
              execution_id: execution.id,
              generation: row.generation,
              epoch: row.epoch,
              reason,
            },
          },
        });
        return true;
      },
      { isolationLevel: 'ReadCommitted', maxWait: 2_000, timeout: 5_000 },
    );
  }
}
