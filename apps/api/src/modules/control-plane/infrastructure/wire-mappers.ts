import type {
  RunnerNode,
  AuditEntry,
  OutboxEvent,
} from '../../../infrastructure/database/generated/client.js';
import type {
  RunnerRecord,
  AuditRecord,
  OutboxRecord,
} from '@ai-runtime/contracts/http';
import { databaseJson } from '../../../shared/infrastructure/json-value.js';
export function presentRunner(row: RunnerNode): RunnerRecord {
  return {
    id: row.id,
    ownerSubject: row.ownerSubject,
    poolId: row.poolId,
    version: row.version,
    capabilities: row.capabilities,
    connectionIds: row.connectionIds,
    capacity: row.capacity,
    status: row.status,
    revision: row.revision,
    lastHeartbeatAt: row.lastHeartbeatAt.toISOString(),
  };
}
export function presentAudit(row: AuditEntry): AuditRecord {
  return {
    id: row.id,
    applicationId: row.applicationId,
    actor: row.actor,
    action: row.action,
    resourceId: row.resourceId,
    revision: row.revision,
    createdAt: row.createdAt.toISOString(),
  };
}
export function presentOutbox(row: OutboxEvent): OutboxRecord {
  return {
    id: row.id,
    applicationId: row.applicationId,
    topic: row.topic,
    aggregateId: row.aggregateId,
    revision: row.revision,
    payload: databaseJson(row.payload),
    createdAt: row.createdAt.toISOString(),
    deliveredAt: row.deliveredAt?.toISOString() ?? null,
  };
}
