import type {
  AdmissionCommand,
  ArtifactCommand,
  ManagementCommand,
  RunnerRegistration,
  UsageCommand,
} from '@ai-runtime/contracts';
import type { Principal } from '../../identity/domain/principal.js';

export interface AdmissionResult {
  execution: {
    id: string;
    applicationId: string;
    status: string;
    revision: number;
    profileRef: string;
    profileRevision: number;
    createdAt: string;
  };
  replayed: boolean;
}

export interface ExecutionView {
  id: string;
  applicationId: string;
  status: string;
  revision: number;
  cancelRequestedAt: string | null;
  profile: { ref: string; revision: number; capability: string };
  accounting: {
    reservations: Array<{
      accountId: string;
      originalUnits: string;
      heldUnits: string;
      postedUnits: string;
      state: string;
    }>;
  };
  attempts: Array<{
    id: string;
    executionId: string;
    number: number;
    generation: number;
    status: string;
    authority: string;
    compute: string;
    external: string;
  }>;
  artifacts: Array<{
    id: string;
    executionId: string;
    name: string;
    digest: string;
    sizeBytes: string;
    mediaType: string;
    status: string;
  }>;
  observations: Array<{
    id: string;
    executionId: string;
    attemptId: string;
    sourceEventId: string;
    sourceRevision: number;
    digest: string;
    coverage: string[];
    cumulativeUnits: string | null;
    completeness: string;
    costBasis: string;
    verification: string;
    reason: string;
    createdAt: string;
  }>;
}
export interface UsageResult {
  observationId: string;
  replayed: boolean;
  postedDelta: string | null;
  completeness: string;
  accounts: Array<{
    accountId: string;
    heldUnits: string;
    postedUnits: string;
    revision: number;
  }>;
}

export interface M1Repository {
  readSnapshot(principal: Principal): Promise<unknown>;
  manage(principal: Principal, command: ManagementCommand): Promise<unknown>;
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
  ): Promise<unknown>;
  registerRunner(
    principal: Principal,
    command: RunnerRegistration,
  ): Promise<unknown>;
  recordInbox(
    principal: Principal,
    consumer: string,
    eventId: string,
  ): Promise<{ replayed: boolean }>;
  readAudit(principal: Principal, applicationId?: string): Promise<unknown>;
  readOutbox(): Promise<unknown>;
}

export const M1_REPOSITORY = Symbol('M1_REPOSITORY');
