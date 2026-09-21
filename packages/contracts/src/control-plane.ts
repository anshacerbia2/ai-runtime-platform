import { z } from 'zod';

const id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,119}$/);
const label = z.string().min(1).max(160);
const status = z.enum(['ENABLED', 'DISABLED']);
const units = z.string().regex(/^(0|[1-9][0-9]{0,14})$/);
const revision = z.number().int().min(0).max(2147483646);
const base = { id, expectedRevision: revision };
export const ManagementCommand = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('application'),
      ...base,
      displayName: label,
      environment: id,
      keycloakClientId: id,
      status,
    })
    .strict(),
  z
    .object({
      kind: z.literal('connection'),
      ...base,
      displayName: label,
      environment: id,
      provider: id,
      authMode: z.enum([
        'API_KEY',
        'OAUTH',
        'WORKLOAD_IDENTITY',
        'RUNTIME_SESSION',
      ]),
      sharingMode: z.enum(['DEDICATED', 'SHARED']),
      quotaGroupRef: id.nullable(),
      status,
    })
    .strict(),
  z
    .object({
      kind: z.literal('credential'),
      ...base,
      connectionId: id,
      residency: z.enum(['CENTRAL', 'RUNNER_LOCAL']),
      runnerRef: id.nullable(),
      status,
    })
    .strict(),
  z
    .object({
      kind: z.literal('binding'),
      id: z.uuid(),
      expectedRevision: revision,
      applicationId: id,
      connectionId: id,
      profileRef: id.nullable(),
      status,
    })
    .strict(),
  z
    .object({
      kind: z.literal('profile'),
      ...base,
      applicationId: id,
      connectionId: id,
      capability: z.enum([
        'chat',
        'generate',
        'structured_generate',
        'agent_execute',
      ]),
      holdUnits: units,
      accountIds: z.array(id).min(1).max(8),
      enabled: z.boolean(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('alias'),
      id,
      applicationId: id,
      expectedRevision: revision,
      revision: revision.refine((value) => value > 0),
      enabled: z.boolean(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('budget'),
      ...base,
      applicationId: id.nullable(),
      quotaGroupRef: id.nullable(),
      unit: id,
      period: id,
      limitUnits: units,
    })
    .strict(),
  z
    .object({
      kind: z.literal('pool'),
      ...base,
      environment: id,
      region: id,
      minimumVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
      status,
    })
    .strict(),
  z
    .object({
      kind: z.literal('runner'),
      ...base,
      status: z.enum(['RUNNING', 'DRAINING', 'DISABLED']),
    })
    .strict(),
]);
export type ManagementCommand = z.infer<typeof ManagementCommand>;

// P1 admits metadata only. It deliberately does not accept provider credentials,
// prompts, caller-supplied scope, runner selection, or a caller-selected hold.
export const AdmissionCommand = z
  .object({ profileRef: id, inputDigest: z.string().regex(/^[a-f0-9]{64}$/) })
  .strict();
export type AdmissionCommand = z.infer<typeof AdmissionCommand>;
export const UsageCommand = z
  .object({
    executionId: z.uuid(),
    attemptId: z.uuid(),
    sourceEventId: id,
    sourceRevision: z.number().int().min(1).max(2147483646),
    coverage: z.array(id).min(1).max(100),
    cumulativeUnits: units.nullable(),
    completeness: z.enum(['complete', 'partial', 'unknown']),
    costBasis: z.enum([
      'provider_reported',
      'estimated',
      'allocated',
      'unknown',
    ]),
    reason: label,
  })
  .strict()
  .refine((value) => new Set(value.coverage).size === value.coverage.length)
  .refine((value) =>
    value.cumulativeUnits === null
      ? value.completeness === 'unknown' && value.costBasis === 'unknown'
      : value.completeness !== 'unknown' && value.costBasis !== 'unknown',
  );
export type UsageCommand = z.infer<typeof UsageCommand>;
export const RunnerRegistration = z
  .object({
    id,
    poolId: id,
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    capabilities: z
      .array(
        z.enum(['chat', 'generate', 'structured_generate', 'agent_execute']),
      )
      .min(1)
      .max(4),
    connectionIds: z.array(id).max(32),
    capacity: z.number().int().min(1).max(1000),
  })
  .strict();
export type RunnerRegistration = z.infer<typeof RunnerRegistration>;
export const ArtifactCommand = z
  .object({
    id: z.uuid(),
    executionId: z.uuid(),
    name: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,119}$/),
    digest: z.string().regex(/^[a-f0-9]{64}$/),
    sizeBytes: units,
    mediaType: z.string().regex(/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/),
  })
  .strict();
export type ArtifactCommand = z.infer<typeof ArtifactCommand>;
