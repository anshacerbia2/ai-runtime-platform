import { z } from 'zod';

const text = z.string();
const revision = z.number().int().nonnegative();
const amount = z.string().regex(/^-?[0-9]+$/);
const timestamp = z.iso.datetime({ offset: true });

export const ApplicationRecord = z.object({
  id: text,
  displayName: text,
  environment: text,
  keycloakClientId: text,
  status: text,
  revision,
});
export const ConnectionRecord = z.object({
  id: text,
  displayName: text,
  provider: text,
  authMode: text,
  environment: text,
  sharingMode: text,
  quotaGroupRef: text.nullable(),
  status: text,
  revision,
});
export const CredentialRecord = z.object({
  id: text,
  connectionId: text,
  residency: text,
  runnerRef: text.nullable(),
  status: text,
  revision,
});
export const BindingRecord = z.object({
  id: text,
  applicationId: text,
  connectionId: text,
  profileRef: text.nullable(),
  status: text,
  revision,
});
export const ProfileRecord = z.object({
  id: text,
  applicationId: text,
  profileRef: text,
  revision,
  connectionId: text,
  capability: text,
  holdUnits: amount,
  accountIds: z.array(text),
  digest: text,
  createdAt: timestamp.optional(),
  enabled: z.boolean().optional(),
  aliasVersion: revision.optional(),
});
export const AliasRecord = z.object({
  applicationId: text,
  profileRef: text,
  revision,
  enabled: z.boolean(),
  version: revision,
});
export const BudgetRecord = z.object({
  id: text,
  applicationId: text.nullable(),
  quotaGroupRef: text.nullable(),
  unit: text,
  period: text,
  limitUnits: amount,
  heldUnits: amount,
  postedUnits: amount,
  revision,
});
export const PoolRecord = z.object({
  id: text,
  environment: text,
  region: text,
  minimumVersion: text,
  status: text,
  revision,
});
export const RunnerRecord = z.object({
  id: text,
  ownerSubject: text,
  poolId: text,
  version: text,
  capabilities: z.array(text),
  connectionIds: z.array(text),
  capacity: z.number().int(),
  status: text,
  revision,
  lastHeartbeatAt: timestamp,
});
export const OperatorSnapshot = z.object({
  applications: z.array(ApplicationRecord),
  connections: z.array(ConnectionRecord),
  credentials: z.array(CredentialRecord),
  bindings: z.array(BindingRecord),
  aliases: z.array(AliasRecord),
  profiles: z.array(ProfileRecord),
  budgets: z.array(BudgetRecord),
  pools: z.array(PoolRecord),
  runners: z.array(RunnerRecord),
});
export const ApplicationSnapshot = z.object({
  application: ApplicationRecord.nullable(),
  bindings: z.array(BindingRecord),
  profiles: z.array(ProfileRecord.omit({ applicationId: true })),
  budgets: z.array(
    BudgetRecord.omit({ applicationId: true, quotaGroupRef: true }),
  ),
  executions: z.array(
    z.object({ id: text, status: text, revision, createdAt: timestamp }),
  ),
});
export const ControlSnapshot = z.union([OperatorSnapshot, ApplicationSnapshot]);
export const ManagementResult = z.union([
  ProfileRecord,
  AliasRecord,
  RunnerRecord,
  ApplicationRecord,
  ConnectionRecord,
  CredentialRecord,
  BindingRecord,
  BudgetRecord,
  PoolRecord,
]);
export const AdmissionResult = z.object({
  execution: z.object({
    id: text,
    applicationId: text,
    status: text,
    revision,
    profileRef: text,
    profileRevision: revision,
    createdAt: timestamp,
  }),
  replayed: z.boolean(),
});
export const ArtifactRecord = z.object({
  id: text,
  executionId: text,
  name: text,
  digest: text,
  sizeBytes: amount,
  mediaType: text,
  status: text,
  replayed: z.boolean().optional(),
});
export const ExecutionView = z.object({
  id: text,
  applicationId: text,
  status: text,
  revision,
  cancelRequestedAt: timestamp.nullable(),
  profile: z.object({ ref: text, revision, capability: text }),
  accounting: z.object({
    reservations: z.array(
      z.object({
        accountId: text,
        originalUnits: amount,
        heldUnits: amount,
        postedUnits: amount,
        state: text,
      }),
    ),
  }),
  attempts: z.array(
    z.object({
      id: text,
      executionId: text,
      number: revision,
      generation: revision,
      status: text,
      authority: text,
      compute: text,
      external: text,
    }),
  ),
  artifacts: z.array(ArtifactRecord),
  observations: z.array(
    z.object({
      id: text,
      executionId: text,
      attemptId: text,
      sourceEventId: text,
      sourceRevision: revision,
      digest: text,
      coverage: z.array(text),
      cumulativeUnits: amount.nullable(),
      completeness: text,
      costBasis: text,
      verification: text,
      reason: text,
      createdAt: timestamp,
    }),
  ),
});
export const UsageResult = z.object({
  observationId: text,
  replayed: z.boolean(),
  postedDelta: amount.nullable(),
  completeness: text,
  accounts: z.array(
    z.object({
      accountId: text,
      heldUnits: amount,
      postedUnits: amount,
      revision,
    }),
  ),
});
export const AuditRecord = z.object({
  id: text,
  applicationId: text.nullable(),
  actor: text,
  action: text,
  resourceId: text,
  revision,
  createdAt: timestamp,
});
export const OutboxRecord = z.object({
  id: text,
  applicationId: text.nullable(),
  topic: text,
  aggregateId: text,
  revision,
  payload: z.unknown(),
  createdAt: timestamp,
  deliveredAt: timestamp.nullable(),
});

export type OperatorSnapshot = z.infer<typeof OperatorSnapshot>;
export type ControlSnapshot = z.infer<typeof ControlSnapshot>;
export type ManagementResult = z.infer<typeof ManagementResult>;
export type AdmissionResult = z.infer<typeof AdmissionResult>;
export type ExecutionView = z.infer<typeof ExecutionView>;
export type UsageResult = z.infer<typeof UsageResult>;
export type ArtifactRecord = z.infer<typeof ArtifactRecord>;
export type RunnerRecord = z.infer<typeof RunnerRecord>;
export type AuditRecord = z.infer<typeof AuditRecord>;
export type OutboxRecord = z.infer<typeof OutboxRecord>;
