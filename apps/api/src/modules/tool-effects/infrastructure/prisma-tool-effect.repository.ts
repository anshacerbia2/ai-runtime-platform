import type { DatabaseService } from '../../../infrastructure/database/database.service.js';
import type { Prisma } from '../../../infrastructure/database/generated/client.js';
import { ApplicationError } from '../../../shared/domain/application-error.js';
import type {
  ToolEffectIntent,
  ToolEffectRecord,
  ToolEffectRepository,
  ToolEffectState,
  ToolReceiverOutcome,
} from '../application/tool-effect.port.js';

interface EffectRow {
  applicationId: string;
  operationId: string;
  executionId: string;
  assignmentId: string;
  attemptId: string;
  generation: number;
  epoch: number;
  toolRef: string;
  requestDigest: string;
  state: string;
  receiptRef: string | null;
  receiptDigest: string | null;
  receiverRetentionUntil: Date;
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^[0-9a-f]{64}$/;
const TOOL_REF = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$/;
const RECEIPT_REF = /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,255}$/;

function checkIntent(intent: ToolEffectIntent) {
  if (
    !UUID.test(intent.operationId) ||
    !UUID.test(intent.executionId) ||
    !UUID.test(intent.assignmentId) ||
    !UUID.test(intent.attemptId) ||
    !intent.applicationId ||
    intent.applicationId.length > 120 ||
    !TOOL_REF.test(intent.toolRef) ||
    !DIGEST.test(intent.requestDigest) ||
    !Number.isSafeInteger(intent.generation) ||
    intent.generation < 1 ||
    !Number.isSafeInteger(intent.epoch) ||
    intent.epoch < 1 ||
    !(intent.receiverRetentionUntil instanceof Date) ||
    !Number.isFinite(intent.receiverRetentionUntil.getTime())
  ) {
    throw new ApplicationError(
      'INVALID_REQUEST',
      'Invalid tool operation intent.',
    );
  }
}

function record(row: EffectRow): ToolEffectRecord {
  if (
    !['PREPARED', 'DISPATCHING', 'UNKNOWN', 'COMMITTED', 'NO_EFFECT'].includes(
      row.state,
    )
  ) {
    throw new Error('Unexpected tool effect state.');
  }
  return {
    applicationId: row.applicationId,
    operationId: row.operationId,
    executionId: row.executionId,
    assignmentId: row.assignmentId,
    attemptId: row.attemptId,
    generation: row.generation,
    epoch: row.epoch,
    toolRef: row.toolRef,
    requestDigest: row.requestDigest.trim(),
    state: row.state as ToolEffectState,
    receiptRef: row.receiptRef,
    receiptDigest: row.receiptDigest?.trim() ?? null,
    receiverRetentionUntil: row.receiverRetentionUntil,
  };
}

function sameOperation(row: ToolEffectRecord, intent: ToolEffectIntent) {
  if (
    row.toolRef !== intent.toolRef ||
    row.requestDigest !== intent.requestDigest
  ) {
    throw new ApplicationError(
      'IDEMPOTENCY_CONFLICT',
      'Tool operation key belongs to different input or tool.',
    );
  }
}

export class PrismaToolEffectRepository implements ToolEffectRepository {
  constructor(
    private readonly db: DatabaseService,
    private readonly strictCoordination = true,
  ) {}

  private async find(
    tx: Prisma.TransactionClient,
    intent: ToolEffectIntent,
  ): Promise<ToolEffectRecord | null> {
    const rows = await tx.$queryRaw<EffectRow[]>`
      SELECT operation_id AS "operationId",
             application_id AS "applicationId",
             execution_id AS "executionId",
             assignment_id AS "assignmentId",
             attempt_id AS "attemptId",
             generation, epoch,
             tool_ref AS "toolRef",
             request_digest AS "requestDigest",
             state,
             receipt_ref AS "receiptRef",
             receipt_digest AS "receiptDigest",
             receiver_retention_until AS "receiverRetentionUntil"
      FROM control.tool_effects
      WHERE application_id = ${intent.applicationId}
        AND operation_id = ${intent.operationId}::uuid
      FOR UPDATE`;
    return rows[0] ? record(rows[0]) : null;
  }

  private async current(
    tx: Prisma.TransactionClient,
    intent: ToolEffectIntent,
  ): Promise<boolean> {
    if (this.strictCoordination) {
      const state = await tx.$queryRaw<
        Array<{ epoch: number; state: string }>
      >`SELECT epoch, state FROM control.runner_coordination WHERE id = 1 FOR SHARE`;
      if (state[0]?.state !== 'ACTIVE' || state[0].epoch !== intent.epoch) {
        return false;
      }
    }
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT e.id
      FROM control.executions e
      JOIN control.attempts t ON t.execution_id = e.id
      JOIN control.runner_assignments a
        ON a.execution_id = e.id AND a.attempt_id = t.id
      WHERE e.id = ${intent.executionId}::uuid
        AND e.application_id = ${intent.applicationId}
        AND e.admission_source = 'AGENT'
        AND e.status = 'RUNNING'
        AND e.cancel_requested_at IS NULL
        AND e.assignment_generation = ${intent.generation}
        AND e.coordination_epoch = ${intent.epoch}
        AND t.id = ${intent.attemptId}::uuid
        AND t.status = 'RUNNING'
        AND t.authority = 'OWNED'
        AND a.id = ${intent.assignmentId}::uuid
        AND a.generation = ${intent.generation}
        AND a.epoch = ${intent.epoch}
        AND a.state = 'STARTED'
        AND a.lease_nonce_digest IS NOT NULL
      FOR UPDATE OF e`;
    return rows.length === 1;
  }

  async prepare(intent: ToolEffectIntent): Promise<ToolEffectRecord> {
    checkIntent(intent);
    return this.db.$transaction(
      async (tx) => {
        const existing = await this.find(tx, intent);
        if (existing) {
          sameOperation(existing, intent);
          return existing;
        }
        if (!(await this.current(tx, intent))) {
          throw new ApplicationError(
            'STALE_ASSIGNMENT',
            'Tool operation is not authorized by the current assignment.',
          );
        }
        // Raw Prisma Date parameters arrive without an offset; PostgreSQL then
        // interprets them in its session timezone. Bind an explicit UTC offset.
        const retentionUntil = intent.receiverRetentionUntil.toISOString();
        const rows = await tx.$queryRaw<EffectRow[]>`
          INSERT INTO control.tool_effects (
            operation_id, application_id, execution_id,
            assignment_id, attempt_id, generation, epoch,
            tool_ref, request_digest, state, receiver_retention_until
          )
          SELECT ${intent.operationId}::uuid, ${intent.applicationId},
                 ${intent.executionId}::uuid, ${intent.assignmentId}::uuid,
                 ${intent.attemptId}::uuid, ${intent.generation}, ${intent.epoch},
                 ${intent.toolRef}, ${intent.requestDigest}, 'PREPARED',
                 ${retentionUntil}::timestamptz
          WHERE ${retentionUntil}::timestamptz > clock_timestamp()
          ON CONFLICT (application_id, operation_id) DO NOTHING
          RETURNING operation_id AS "operationId",
                    application_id AS "applicationId",
                    execution_id AS "executionId",
                    assignment_id AS "assignmentId",
                    attempt_id AS "attemptId",
                    generation, epoch,
                    tool_ref AS "toolRef",
                    request_digest AS "requestDigest",
                    state,
                    receipt_ref AS "receiptRef",
                    receipt_digest AS "receiptDigest",
                    receiver_retention_until AS "receiverRetentionUntil"`;
        if (rows[0]) {
          return record(rows[0]);
        }
        const concurrent = await this.find(tx, intent);
        if (concurrent) {
          sameOperation(concurrent, intent);
          return concurrent;
        }
        throw new ApplicationError(
          'INVALID_REQUEST',
          'Receiver retention has already expired.',
        );
      },
      { isolationLevel: 'ReadCommitted', maxWait: 2_000, timeout: 5_000 },
    );
  }

  async claim(intent: ToolEffectIntent): Promise<boolean> {
    checkIntent(intent);
    return this.db.$transaction(
      async (tx) => {
        if (!(await this.current(tx, intent))) {
          return false;
        }
        const changed = await tx.$executeRaw`
          UPDATE control.tool_effects
          SET state = 'DISPATCHING', updated_at = clock_timestamp()
          WHERE application_id = ${intent.applicationId}
            AND operation_id = ${intent.operationId}::uuid
            AND tool_ref = ${intent.toolRef}
            AND request_digest = ${intent.requestDigest}
            AND state = 'PREPARED'
            AND receiver_retention_until > clock_timestamp()`;
        return changed === 1;
      },
      { isolationLevel: 'ReadCommitted', maxWait: 2_000, timeout: 5_000 },
    );
  }

  async recordOutcome(
    intent: ToolEffectIntent,
    outcome: ToolReceiverOutcome,
  ): Promise<ToolEffectRecord> {
    checkIntent(intent);
    if (
      outcome.state !== 'UNKNOWN' &&
      (!RECEIPT_REF.test(outcome.receiptRef) ||
        !DIGEST.test(outcome.receiptDigest))
    ) {
      throw new ApplicationError('INVALID_REQUEST', 'Invalid tool receipt.');
    }
    return this.db.$transaction(
      async (tx) => {
        const existing = await this.find(tx, intent);
        if (!existing) {
          throw new ApplicationError('NOT_FOUND', 'Tool operation not found.');
        }
        sameOperation(existing, intent);
        if (existing.state === 'COMMITTED' || existing.state === 'NO_EFFECT') {
          if (
            outcome.state !== 'UNKNOWN' &&
            (existing.state !== outcome.state ||
              existing.receiptRef !== outcome.receiptRef ||
              existing.receiptDigest !== outcome.receiptDigest)
          ) {
            throw new ApplicationError(
              'IDEMPOTENCY_CONFLICT',
              'Receiver returned conflicting tool effect evidence.',
            );
          }
          return existing;
        }
        const state = outcome.state;
        await tx.$executeRaw`
          UPDATE control.tool_effects
          SET state = ${state},
              receipt_ref = ${outcome.state === 'UNKNOWN' ? null : outcome.receiptRef},
              receipt_digest = ${outcome.state === 'UNKNOWN' ? null : outcome.receiptDigest},
              updated_at = clock_timestamp()
          WHERE application_id = ${intent.applicationId}
            AND operation_id = ${intent.operationId}::uuid`;
        return (await this.find(tx, intent))!;
      },
      { isolationLevel: 'ReadCommitted', maxWait: 2_000, timeout: 5_000 },
    );
  }
}
