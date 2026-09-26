import type { ManagementReceipt } from '@ai-runtime/contracts/http';
import type {
  AdmissionCommand,
  ArtifactCommand,
  ManagementCommand,
  RunnerRegistration,
  UsageCommand,
} from '@ai-runtime/contracts';
import type { Principal } from '../../identity/domain/principal.js';
import type {
  AdmissionResult,
  ExecutionView,
  UsageResult,
  ControlSnapshot,
  ManagementResult,
  ArtifactRecord,
  RunnerRecord,
  AuditRecord,
  OutboxRecord,
} from '@ai-runtime/contracts/http';
export type {
  AdmissionResult,
  ExecutionView,
  UsageResult,
} from '@ai-runtime/contracts/http';

export interface M1Repository {
  readSnapshot(principal: Principal): Promise<ControlSnapshot>;
  manageReceipted(
    principal: Principal,
    command: ManagementCommand,
    key: string,
  ): Promise<ManagementReceipt>;
  manage(
    principal: Principal,
    command: ManagementCommand,
  ): Promise<ManagementResult>;
  admit(
    principal: Principal,
    command: AdmissionCommand,
    idempotencyKey: string,
  ): Promise<AdmissionResult>;
  readExecution(
    principal: Principal,
    executionId: string,
  ): Promise<ExecutionView>;
  cancelExecution(
    principal: Principal,
    executionId: string,
    reason: string | null,
  ): Promise<ExecutionView>;
  recordUsage(
    principal: Principal,
    command: UsageCommand,
  ): Promise<UsageResult>;
  registerArtifact(
    principal: Principal,
    command: ArtifactCommand,
  ): Promise<ArtifactRecord>;
  registerRunner(
    principal: Principal,
    command: RunnerRegistration,
  ): Promise<RunnerRecord>;
  recordInbox(
    principal: Principal,
    consumer: string,
    eventId: string,
  ): Promise<{ replayed: boolean }>;
  readAudit(
    principal: Principal,
    applicationId?: string,
  ): Promise<AuditRecord[]>;
  readOutbox(): Promise<OutboxRecord[]>;
}

export const M1_REPOSITORY = Symbol('M1_REPOSITORY');
