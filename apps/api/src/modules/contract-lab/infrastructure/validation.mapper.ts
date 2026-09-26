import type {
  ContractCheck,
  Prisma,
} from '../../../infrastructure/database/generated/client.js';
import type { ValidationRecord } from '../domain/validation-record.js';
import { CheckReport } from '@ai-runtime/contracts';
import { databaseJson } from '../../../shared/infrastructure/json-value.js';

export function toValidationRecord(record: ContractCheck): ValidationRecord {
  if (!['chat', 'generate', 'execution'].includes(record.kind)) {
    throw new Error('Invalid persisted contract kind.');
  }
  return {
    id: record.id,
    applicationId: record.applicationId,
    kind: record.kind as ValidationRecord['kind'],
    valid: record.valid,
    contractVersion: record.contractVersion,
    requestDigest: record.requestDigest,
    requestSummary: record.requestSummary,
    report: CheckReport.parse(record.report),
    createdAt: record.createdAt,
  };
}

/** Explicit serialization boundary, never a Prisma type exposed to a use case. */
export function toDatabaseJson(value: unknown): Prisma.InputJsonValue {
  return databaseJson(value);
}
