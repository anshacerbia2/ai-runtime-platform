import { createHash, randomUUID } from 'node:crypto';
import {
  Assignment,
  receiptPolicy,
  type AssignmentToken,
  type AssignCommand,
  type RevokeCommand,
  type RunnerReport,
  type LateEvidence,
} from '@ai-runtime/contracts/http';
import { canonicalJson } from '@ai-runtime/contracts';
import type {
  Prisma,
  RunnerAssignment,
} from '../../../infrastructure/database/generated/client.js';
import type { DatabaseService } from '../../../infrastructure/database/database.service.js';
import type { RunnerAuthority } from '../application/runner-authority.port.js';
import type { Principal } from '../../identity/domain/principal.js';
import { ApplicationError } from '../../../shared/domain/application-error.js';
import { databaseJson } from '../../../shared/infrastructure/json-value.js';
const hash = (value: unknown) =>
  createHash('sha256').update(canonicalJson(value)).digest('hex');
function present(row: RunnerAssignment) {
  return Assignment.parse({
    assignmentId: row.id,
    executionId: row.executionId,
    attemptId: row.attemptId,
    runnerId: row.runnerId,
    ownerSubject: row.ownerSubject,
    generation: row.generation,
    epoch: row.epoch,
    state: row.state,
    protocolVersion: row.protocolVersion,
  });
}
function stale(): never {
  throw new ApplicationError(
    'STALE_ASSIGNMENT',
    'Assignment is not the current authorized generation.',
  );
}
export class PrismaRunnerAuthority implements RunnerAuthority {
  constructor(private readonly db: DatabaseService) {}
  private transaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>) {
    return this.db.$transaction(work, {
      isolationLevel: 'ReadCommitted',
      maxWait: 2000,
      timeout: 5000,
    });
  }
  private async execution(tx: Prisma.TransactionClient, id: string) {
    await tx.$queryRaw`SELECT id FROM control.executions WHERE id=${id}::uuid FOR UPDATE`;
    const execution = await tx.execution.findUnique({ where: { id } });
    if (!execution) {
      throw new ApplicationError('NOT_FOUND', 'Execution not found.');
    }
    return execution;
  }
  private async receipt(
    p: Principal,
    operation: string,
    key: string,
    input: unknown,
    work: (tx: Prisma.TransactionClient) => Promise<Assignment>,
  ) {
    const scopeKey = createHash('sha256')
      .update(p.kind + ':' + p.subject)
      .digest('hex');
    const requestDigest = hash({ version: 1, operation, input });
    return this.transaction(async (tx) => {
      const id = randomUUID();
      const inserted = await tx.managementReceipt.createMany({
        data: [
          {
            id,
            scopeKey,
            requestKey: key,
            operation,
            requestDigest,
            response: {},
            completed: false,
            expiresAt: new Date(Date.now() + receiptPolicy.replayWindowMs),
          },
        ],
        skipDuplicates: true,
      });
      if (!inserted.count) {
        const previous = await tx.managementReceipt.findUniqueOrThrow({
          where: { scopeKey_requestKey: { scopeKey, requestKey: key } },
        });
        if (
          previous.requestDigest !== requestDigest ||
          previous.operation !== operation
        ) {
          throw new ApplicationError(
            'IDEMPOTENCY_CONFLICT',
            'Request key was used for a different operation.',
          );
        }
        if (!previous.completed) {
          throw new ApplicationError(
            'DEPENDENCY_UNAVAILABLE',
            'Receipt is not completed.',
          );
        }
        if (previous.expiresAt.getTime() <= Date.now()) {
          throw new ApplicationError(
            'REQUEST_KEY_EXPIRED',
            'The retained key has expired.',
          );
        }
        return Assignment.parse(previous.response);
      }
      const result = await work(tx);
      await tx.managementReceipt.update({
        where: { id },
        data: {
          completed: true,
          completedAt: new Date(),
          response: databaseJson(result),
        },
      });
      return result;
    });
  }
  grant(p: Principal, id: string, c: AssignCommand, key: string) {
    return this.receipt(
      p,
      'runner.assign',
      key,
      { id, command: c },
      async (tx) => {
        const execution = await this.execution(tx, id);
        if (c.protocolVersion !== '1') {
          throw new ApplicationError(
            'VERSION_UNSUPPORTED',
            'Unsupported runner protocol.',
          );
        }
        if (execution.assignmentGeneration !== c.expectedGeneration) {
          stale();
        }
        if (
          execution.cancelRequestedAt ||
          !['ACCEPTED', 'RUNNING'].includes(execution.status)
        ) {
          throw new ApplicationError(
            'POLICY_DENIED',
            'Execution does not permit a new assignment.',
          );
        }
        if (execution.assignmentGeneration >= 2147483645) {
          throw new ApplicationError(
            'RESOURCE_EXHAUSTED',
            'Generation space exhausted.',
          );
        }
        const current = await tx.runnerAssignment.findUnique({
          where: {
            executionId_generation: {
              executionId: id,
              generation: execution.assignmentGeneration,
            },
          },
        });
        if (current && current.state !== 'FENCED') {
          throw new ApplicationError(
            'IDEMPOTENCY_CONFLICT',
            'Revoke current authority before reassignment.',
          );
        }
        const attempt = await tx.attempt.findFirst({
          where: { id: c.attemptId, executionId: id },
        });
        if (!attempt) {
          throw new ApplicationError(
            'NOT_FOUND',
            'Attempt does not belong to this execution.',
          );
        }
        await tx.$queryRaw`SELECT id FROM control.runner_nodes WHERE id=${c.runnerId} FOR UPDATE`;
        const runner = await tx.runnerNode.findUnique({
          where: { id: c.runnerId },
          include: { pool: true },
        });
        if (runner) {
          await tx.$queryRaw`SELECT id FROM control.runner_pools WHERE id=${runner.poolId} FOR SHARE`;
        }
        const pool = runner
          ? await tx.runnerPool.findUnique({ where: { id: runner.poolId } })
          : null;
        const profile = await tx.profileRevision.findUniqueOrThrow({
          where: { id: execution.profileRevisionId },
        });
        if (
          !runner ||
          runner.status !== 'RUNNING' ||
          pool?.status !== 'ENABLED' ||
          !runner.capabilities.includes(profile.capability) ||
          !runner.connectionIds.includes(profile.connectionId)
        ) {
          throw new ApplicationError(
            'POLICY_DENIED',
            'Runner is not eligible for this profile and connection.',
          );
        }
        const active = await tx.runnerAssignment.count({
          where: {
            runnerId: c.runnerId,
            state: { in: ['GRANTED', 'STARTED', 'RESULT_PROPOSED'] },
          },
        });
        if (active >= runner.capacity) {
          throw new ApplicationError(
            'RESOURCE_EXHAUSTED',
            'Runner capacity is exhausted.',
          );
        }
        const generation = execution.assignmentGeneration + 1;
        await tx.execution.update({
          where: { id },
          data: {
            assignmentGeneration: generation,
            revision: { increment: 1 },
          },
        });
        const assignment = await tx.runnerAssignment.create({
          data: {
            id: randomUUID(),
            executionId: id,
            attemptId: attempt.id,
            runnerId: runner.id,
            ownerSubject: runner.ownerSubject,
            generation,
            epoch: execution.coordinationEpoch,
            state: 'GRANTED',
            protocolVersion: '1',
          },
        });
        await tx.attempt.update({
          where: { id: attempt.id },
          data: { generation, authority: 'OWNED' },
        });
        await tx.auditEntry.create({
          data: {
            id: randomUUID(),
            applicationId: execution.applicationId,
            actor: p.subject,
            action: 'runner.assignment-granted',
            resourceId: id,
            revision: execution.revision + 1,
          },
        });
        return present(assignment);
      },
    );
  }
  revoke(p: Principal, id: string, c: RevokeCommand, key: string) {
    return this.receipt(
      p,
      'runner.revoke',
      key,
      { id, command: c },
      async (tx) => {
        const execution = await this.execution(tx, id);
        const row = await tx.runnerAssignment.findUnique({
          where: { id: c.assignmentId },
        });
        if (
          !row ||
          row.executionId !== id ||
          row.generation !== c.generation ||
          execution.assignmentGeneration !== c.generation
        ) {
          stale();
        }
        if (execution.assignmentGeneration >= 2147483645) {
          throw new ApplicationError(
            'RESOURCE_EXHAUSTED',
            'Generation space exhausted.',
          );
        }
        const fenced = await tx.runnerAssignment.update({
          where: { id: row.id },
          data: { state: 'FENCED' },
        });
        await tx.execution.update({
          where: { id },
          data: {
            assignmentGeneration: { increment: 1 },
            revision: { increment: 1 },
          },
        });
        await tx.attempt.update({
          where: { id: row.attemptId },
          data: { authority: 'FENCED' },
        });
        await tx.auditEntry.create({
          data: {
            id: randomUUID(),
            applicationId: execution.applicationId,
            actor: p.subject,
            action: 'runner.assignment-fenced',
            resourceId: id,
            revision: execution.revision + 1,
          },
        });
        return present(fenced);
      },
    );
  }
  private async owned(
    tx: Prisma.TransactionClient,
    p: Principal,
    token: AssignmentToken,
  ) {
    const row = await tx.runnerAssignment.findUnique({
      where: { id: token.assignmentId },
    });
    if (
      !row ||
      row.executionId !== token.executionId ||
      row.attemptId !== token.attemptId ||
      row.runnerId !== token.runnerId ||
      row.ownerSubject !== p.subject ||
      row.generation !== token.generation ||
      row.epoch !== token.epoch
    ) {
      stale();
    }
    return row;
  }
  report(p: Principal, report: RunnerReport) {
    return this.transaction(async (tx) => {
      const execution = await this.execution(tx, report.token.executionId);
      const row = await this.owned(tx, p, report.token);
      if (
        execution.assignmentGeneration !== row.generation ||
        execution.coordinationEpoch !== row.epoch ||
        row.state === 'FENCED' ||
        execution.cancelRequestedAt
      ) {
        stale();
      }
      await tx.$queryRaw`SELECT id FROM control.runner_nodes WHERE id=${row.runnerId} FOR SHARE`;
      const runner = await tx.runnerNode.findUnique({
        where: { id: row.runnerId },
      });
      if (
        !runner ||
        runner.ownerSubject !== p.subject ||
        runner.status === 'DISABLED'
      ) {
        stale();
      }
      if (!['ACCEPTED', 'RUNNING'].includes(execution.status)) {
        stale();
      }
      if (report.type === 'started') {
        if (row.state === 'STARTED') {
          return present(row);
        }
        if (row.state !== 'GRANTED') {
          stale();
        }
        await tx.attempt.update({
          where: { id: row.attemptId },
          data: { status: 'RUNNING', authority: 'OWNED' },
        });
        await tx.execution.update({
          where: { id: execution.id },
          data: { status: 'RUNNING', revision: { increment: 1 } },
        });
        return present(
          await tx.runnerAssignment.update({
            where: { id: row.id },
            data: { state: 'STARTED' },
          }),
        );
      }
      const digest = hash(report.proposal);
      if (row.state === 'RESULT_PROPOSED') {
        if (row.proposalDigest !== digest) {
          throw new ApplicationError(
            'IDEMPOTENCY_CONFLICT',
            'A different result was already proposed.',
          );
        }
        return present(row);
      }
      if (row.state !== 'STARTED') {
        throw new ApplicationError(
          'POLICY_DENIED',
          'Runner must acknowledge start before proposing a result.',
        );
      }
      for (const artifactId of report.proposal.artifactIds) {
        if (
          !(await tx.artifactMetadata.findFirst({
            where: { id: artifactId, executionId: execution.id },
            select: { id: true },
          }))
        ) {
          throw new ApplicationError(
            'NOT_FOUND',
            'Artifact does not belong to the execution.',
          );
        }
      }
      const updated = await tx.runnerAssignment.update({
        where: { id: row.id },
        data: {
          state: 'RESULT_PROPOSED',
          proposal: databaseJson(report.proposal),
          proposalDigest: digest,
        },
      });
      // A runner proposal is NOT an official completed execution or an accounting settlement.
      await tx.outboxEvent.create({
        data: {
          id: randomUUID(),
          applicationId: execution.applicationId,
          topic: 'runner.result-proposed',
          aggregateId: row.id,
          revision: 1,
          payload: {
            assignment_id: row.id,
            execution_id: execution.id,
            generation: row.generation,
            digest,
          },
        },
      });
      return present(updated);
    });
  }
  evidence(p: Principal, input: LateEvidence) {
    return this.transaction(async (tx) => {
      const execution = await this.execution(tx, input.token.executionId);
      const row = await this.owned(tx, p, input.token);
      const evidence = input.evidence;
      if (
        evidence.executionId !== row.executionId ||
        evidence.attemptId !== row.attemptId
      ) {
        throw new ApplicationError('POLICY_DENIED', 'Evidence scope mismatch.');
      }
      const digest = hash(evidence);
      const id = randomUUID();
      const inserted = await tx.runnerEvidence.createMany({
        data: [
          {
            id,
            assignmentId: row.id,
            executionId: row.executionId,
            attemptId: row.attemptId,
            sourceEventId: evidence.sourceEventId,
            sourceRevision: evidence.sourceRevision,
            digest,
            payload: databaseJson(evidence),
            state: 'QUARANTINED',
          },
        ],
        skipDuplicates: true,
      });
      const stored = await tx.runnerEvidence.findUniqueOrThrow({
        where: {
          assignmentId_sourceEventId_sourceRevision: {
            assignmentId: row.id,
            sourceEventId: evidence.sourceEventId,
            sourceRevision: evidence.sourceRevision,
          },
        },
      });
      if (stored.digest !== digest) {
        throw new ApplicationError(
          'IDEMPOTENCY_CONFLICT',
          'Evidence identity contains conflicting content.',
        );
      }
      return {
        id: stored.id,
        state: 'QUARANTINED' as const,
        replayed: inserted.count === 0,
        stale:
          execution.assignmentGeneration !== row.generation ||
          execution.coordinationEpoch !== row.epoch ||
          row.state === 'FENCED',
      };
    });
  }
}
