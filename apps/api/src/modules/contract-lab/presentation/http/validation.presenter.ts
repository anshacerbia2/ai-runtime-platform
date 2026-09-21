import type { ValidationRecord } from '../../domain/validation-record.js';

export function presentValidation(record: ValidationRecord) {
  return {
    id: record.id,
    application_id: record.applicationId,
    kind: record.kind,
    valid: record.valid,
    contract_version: record.contractVersion,
    request_digest: record.requestDigest,
    request_summary: record.requestSummary,
    report: record.report,
    created_at: record.createdAt.toISOString(),
  };
}
