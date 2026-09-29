import { createHash } from 'node:crypto';
import type { RunnerLeaseCommand } from '@ai-runtime/contracts/http';
import type { Prisma } from '../../../infrastructure/database/generated/client.js';
import type { DatabaseService } from '../../../infrastructure/database/database.service.js';
import { ApplicationError } from '../../../shared/domain/application-error.js';
import type {
  RunnerLeaseAuthority,
  RunnerLeaseStatus,
} from '../application/runner-lease-authority.port.js';

type LeaseRow = Prisma.RunnerAssignmentGetPayload<{
  include: { execution: true; runner: true };
}>;

function nonceDigest(nonce: string) {
  return createHash('sha256').update(nonce).digest('hex');
}

function statusOf(
  row: LeaseRow | null,
  command: RunnerLeaseCommand,
  ownerSubject: string,
): RunnerLeaseStatus {
  const token = command.token;
  if (
    !row ||
    row.executionId !== token.executionId ||
    row.attemptId !== token.attemptId ||
    row.runnerId !== token.runnerId ||
    row.ownerSubject !== ownerSubject ||
    row.claimBootId !== command.bootId ||
    row.generation !== token.generation ||
    row.epoch !== token.epoch ||
    !['GRANTED', 'STARTED'].includes(row.state) ||
    row.execution.admissionSource !== 'AGENT' ||
    !['ACCEPTED', 'RUNNING'].includes(row.execution.status) ||
    row.execution.cancelRequestedAt ||
    row.execution.assignmentGeneration !== row.generation ||
    row.execution.coordinationEpoch !== row.epoch ||
    row.runner.ownerSubject !== ownerSubject ||
    row.runner.revision !== command.registrationRevision ||
    row.runner.status !== 'RUNNING' ||
    (row.leaseNonceDigest !== null &&
      row.leaseNonceDigest.trim() !== nonceDigest(command.nonce))
  ) {
    throw new ApplicationError(
      'STALE_ASSIGNMENT',
      'Assignment lease cannot be activated or renewed.',
    );
  }
  return row.leaseNonceDigest === null ? 'UNINITIALIZED' : 'CURRENT';
}

export class PrismaRunnerLeaseAuthority implements RunnerLeaseAuthority {
  constructor(private readonly db: DatabaseService) {}

  async status(command: RunnerLeaseCommand, ownerSubject: string) {
    const row = await this.db.runnerAssignment.findUnique({
      where: { id: command.token.assignmentId },
      include: { execution: true, runner: true },
    });
    return statusOf(row, command, ownerSubject);
  }

  async confirm(command: RunnerLeaseCommand, ownerSubject: string) {
    await this.db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM control.executions WHERE id = ${command.token.executionId}::uuid FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM control.runner_nodes WHERE id = ${command.token.runnerId} FOR SHARE`;
        const row = await tx.runnerAssignment.findUnique({
          where: { id: command.token.assignmentId },
          include: { execution: true, runner: true },
        });
        if (statusOf(row, command, ownerSubject) === 'UNINITIALIZED') {
          await tx.runnerAssignment.update({
            where: { id: command.token.assignmentId },
            data: { leaseNonceDigest: nonceDigest(command.nonce) },
          });
        }
      },
      { isolationLevel: 'ReadCommitted', maxWait: 2_000, timeout: 5_000 },
    );
  }
}
