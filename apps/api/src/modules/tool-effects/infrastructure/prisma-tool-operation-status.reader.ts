import type {
  ToolOperationPage,
  ToolOperationStatus,
} from '@ai-runtime/contracts/http';
import type { DatabaseService } from '../../../infrastructure/database/database.service.js';
import type { ToolEffect } from '../../../infrastructure/database/generated/client.js';
import { ApplicationError } from '../../../shared/domain/application-error.js';
import type { ToolOperationStatusReader } from '../application/tool-operation-status.port.js';

function view(row: ToolEffect): ToolOperationStatus {
  const common = {
    operationId: row.operationId,
    executionId: row.executionId,
    toolRef: row.toolRef,
    requestDigest: row.requestDigest.trim(),
    receiverRetentionUntil: row.receiverRetentionUntil.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
  switch (row.state) {
    case 'PREPARED':
    case 'DISPATCHING':
    case 'UNKNOWN':
      if (row.receiptRef !== null || row.receiptDigest !== null) {
        break;
      }
      return { ...common, state: row.state, receipt: null };
    case 'COMMITTED':
    case 'NO_EFFECT':
      if (row.receiptRef === null || row.receiptDigest === null) {
        break;
      }
      return {
        ...common,
        state: row.state,
        receipt: { ref: row.receiptRef, digest: row.receiptDigest.trim() },
      };
  }
  throw new Error('Invalid persisted tool operation state.');
}

export class PrismaToolOperationStatusReader implements ToolOperationStatusReader {
  constructor(private readonly db: DatabaseService) {}

  async read(
    applicationId: string,
    executionId: string,
    operationId: string,
  ): Promise<ToolOperationStatus | null> {
    const row = await this.db.toolEffect.findFirst({
      where: { applicationId, executionId, operationId },
    });
    return row ? view(row) : null;
  }

  async list(
    applicationId: string,
    executionId: string,
    query: { limit: number; after?: string },
  ): Promise<ToolOperationPage> {
    // Distinguish an owned execution without effects from an inaccessible execution.
    const execution = await this.db.execution.findFirst({
      where: { id: executionId, applicationId },
      select: { id: true },
    });
    if (!execution) {
      throw new ApplicationError('NOT_FOUND', 'Execution not found.');
    }
    const rows = await this.db.toolEffect.findMany({
      where: {
        applicationId,
        executionId,
        ...(query.after ? { operationId: { gt: query.after } } : {}),
      },
      orderBy: { operationId: 'asc' },
      take: query.limit + 1,
    });
    const items = rows.slice(0, query.limit).map(view);
    return {
      items,
      nextAfter: rows.length > query.limit ? items.at(-1)!.operationId : null,
      limit: query.limit,
      consistency: 'live-keyset',
    };
  }
}
