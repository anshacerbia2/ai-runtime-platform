import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '../../../infrastructure/database/generated/client.js';
import { ApplicationError } from '../../../shared/domain/application-error.js';
import type { ValidationRepository } from '../application/ports/validation-repository.port.js';
import type { ValidationDraft } from '../domain/validation-record.js';
import { toDatabaseJson, toValidationRecord } from './validation.mapper.js';

export class PrismaValidationRepository implements ValidationRepository {
  constructor(private readonly database: PrismaClient) {}

  async saveIdempotent(draft: ValidationDraft) {
    return this.database.$transaction(
      async (transaction) => {
        const inserted = await transaction.contractCheck.createMany({
          data: [
            {
              id: randomUUID(),
              applicationId: draft.applicationId,
              idempotencyKey: draft.idempotencyKey,
              kind: draft.kind,
              requestDigest: draft.requestDigest,
              contractVersion: draft.report.contract_version,
              valid: draft.report.valid,
              requestSummary: toDatabaseJson(draft.requestSummary),
              report: toDatabaseJson(draft.report),
            },
          ],
          skipDuplicates: true,
        });
        const stored = await transaction.contractCheck.findUniqueOrThrow({
          where: {
            applicationId_idempotencyKey: {
              applicationId: draft.applicationId,
              idempotencyKey: draft.idempotencyKey,
            },
          },
        });
        if (stored.requestDigest !== draft.requestDigest) {
          throw new ApplicationError(
            'IDEMPOTENCY_CONFLICT',
            'Key sudah digunakan untuk payload berbeda. Gunakan key baru.',
          );
        }
        return {
          record: toValidationRecord(stored),
          replayed: inserted.count === 0,
        };
      },
      { isolationLevel: 'ReadCommitted', maxWait: 3000, timeout: 5000 },
    );
  }

  async findOwned(applicationId: string, id: string) {
    const record = await this.database.contractCheck.findFirst({
      where: { id, applicationId },
    });
    return record ? toValidationRecord(record) : null;
  }

  async listOwned(applicationId: string, limit: number, afterId?: string) {
    // The DB resolves the cursor row's original timestamp; JS millisecond rounding
    // must not truncate PostgreSQL microsecond precision and skip rows.
    const rows = await this.database.contractCheck.findMany({
      where: { applicationId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(afterId ? { cursor: { id: afterId }, skip: 1 } : {}),
    });
    const items = rows.slice(0, limit).map(toValidationRecord);
    return { items, nextId: rows.length > limit ? items.at(-1)!.id : null };
  }

  countOwned(applicationId: string) {
    return this.database.contractCheck.count({ where: { applicationId } });
  }
}
