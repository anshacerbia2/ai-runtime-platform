import { randomUUID } from 'node:crypto';
import type { DatabaseService } from '../../../infrastructure/database/database.service.js';
import type {
  RunnerCoordinationAuthority,
  RunnerCoordinationState,
  RunnerCoordinationStore,
} from '../application/runner-coordination.port.js';

export class PrismaRunnerCoordinationRepository implements RunnerCoordinationAuthority {
  constructor(private readonly db: DatabaseService) {}

  async read(): Promise<RunnerCoordinationState> {
    const row = await this.db.runnerCoordination.findUniqueOrThrow({
      where: { id: 1 },
    });
    if (row.state !== 'ACTIVE' && row.state !== 'PAUSED') {
      throw new Error('Runner coordination state is invalid.');
    }
    return { epoch: row.epoch, state: row.state, marker: row.marker };
  }

  async pauseIfCurrent(current: RunnerCoordinationState): Promise<boolean> {
    const changed = await this.db.runnerCoordination.updateMany({
      where: {
        id: 1,
        state: 'ACTIVE',
        epoch: current.epoch,
        marker: current.marker,
      },
      data: {
        state: 'PAUSED',
        revision: { increment: 1 },
        updatedAt: new Date(),
      },
    });
    return changed.count === 1;
  }

  async resume(store: RunnerCoordinationStore): Promise<boolean> {
    return this.db.$transaction(
      async (tx) => {
        const locked = await tx.$queryRaw<Array<{ id: number }>>`
          SELECT id FROM control.runner_coordination WHERE id = 1
          FOR UPDATE SKIP LOCKED`;
        if (locked.length === 0) {
          return false;
        }
        const row = await tx.runnerCoordination.findUniqueOrThrow({
          where: { id: 1 },
        });
        if (row.state !== 'PAUSED' || row.epoch >= 2_147_483_645) {
          return false;
        }
        const active = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT a.id
          FROM control.runner_assignments a
          JOIN control.executions e ON e.id = a.execution_id
          WHERE a.claim_boot_id IS NOT NULL
            AND a.state IN ('GRANTED', 'STARTED', 'RESULT_PROPOSED')
            AND e.admission_source = 'AGENT'
            AND e.status IN ('ACCEPTED', 'RUNNING')
            AND e.assignment_generation = a.generation
            AND e.coordination_epoch = a.epoch
          LIMIT 1`;
        if (active.length !== 0) {
          return false;
        }
        const marker = randomUUID();
        await store.write(marker);
        await tx.runnerCoordination.update({
          where: { id: 1 },
          data: {
            epoch: { increment: 1 },
            state: 'ACTIVE',
            marker,
            revision: { increment: 1 },
            updatedAt: new Date(),
          },
        });
        return true;
      },
      { isolationLevel: 'ReadCommitted', maxWait: 2_000, timeout: 5_000 },
    );
  }
}
