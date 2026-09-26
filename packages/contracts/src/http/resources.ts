import { initContract } from '@ts-rest/core';
import { z } from 'zod';
import { ManagementCommand } from '../control-plane.js';
import * as view from './control-plane.js';

const c = initContract();
export const RequestKeyHeaders = z.object({
  'idempotency-key': z.string().regex(/^[A-Za-z0-9._:-]{1,160}$/),
});
export const ResourceId = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$/);
export const PageQuery = z
  .object({
    limit: z
      .string()
      .regex(/^(?:[1-9]|[1-9][0-9]|100)$/)
      .optional(),
    cursor: z.string().min(1).max(1024).optional(),
  })
  .strict();
export type PageInput = z.infer<typeof PageQuery>;
export const resourceNames = [
  'applications',
  'connections',
  'credentials',
  'bindings',
  'profiles',
  'aliases',
  'budgets',
  'pools',
  'runners',
  'audit',
  'outbox',
] as const;
export type ResourceName = (typeof resourceNames)[number];
export const ResourceName = z.enum(resourceNames);
export const ResourcePageSchemas = {
  applications: view.ApplicationRecord,
  connections: view.ConnectionRecord,
  credentials: view.CredentialRecord,
  bindings: view.BindingRecord,
  profiles: view.ProfileRecord,
  aliases: view.AliasRecord,
  budgets: view.BudgetRecord,
  pools: view.PoolRecord,
  runners: view.RunnerRecord,
  audit: view.AuditRecord,
  outbox: view.OutboxRecord.omit({ payload: true }),
} as const;
export const ReceiptInfo = z.object({
  id: z.uuid(),
  key: z.string(),
  replayed: z.boolean(),
  completedAt: z.iso.datetime({ offset: true }),
});
export const receiptPolicy = Object.freeze({
  replayWindowMs: 7 * 24 * 60 * 60 * 1000,
  maxReceiptBytes: 65536,
  tombstone: 'retain-no-silent-key-reuse',
});
export const managementBehavior = {
  replay: 'receipt',
  maxAttempts: 3,
  fingerprint: 'sha256-canonical-command-v1',
  receiptReplayDays: 7,
  retainedTombstones: true,
  retryOwner: 'client',
  maxResponseBytes: 65536,
} as const;
const readBehavior = {
  replay: 'read',
  maxAttempts: 1,
  maxResponseBytes: 1048576,
} as const;
export function page<T extends z.ZodType>(schema: T) {
  return z.object({
    items: z.array(schema).max(100),
    nextCursor: z.string().nullable(),
    limit: z.number().int().positive().max(100),
    consistency: z.literal('live-keyset'),
  });
}
function receipt<T extends z.ZodType>(schema: T) {
  return z.object({ resource: schema, receipt: ReceiptInfo });
}
export const Overview = z.object({
  observedAt: z.iso.datetime({ offset: true }),
  consistency: z.literal('independent-observations'),
  counts: z.object({
    applications: z.number().int().nonnegative(),
    connections: z.number().int().nonnegative(),
    credentials: z.number().int().nonnegative(),
    bindings: z.number().int().nonnegative(),
    profiles: z.number().int().nonnegative(),
    aliases: z.number().int().nonnegative(),
    budgets: z.number().int().nonnegative(),
    pools: z.number().int().nonnegative(),
    runners: z.number().int().nonnegative(),
  }),
});

export const resourceContract = c.router({
  applications: {
    list: {
      method: 'GET',
      path: '/api/v1/applications',
      query: PageQuery,
      metadata: { behavior: readBehavior },
      responses: { 200: page(ResourcePageSchemas.applications) },
    },
    replace: {
      method: 'PUT',
      path: '/api/v1/applications/:id',
      headers: RequestKeyHeaders,
      pathParams: z.object({ id: ResourceId }),
      body: ManagementCommand.options[0].omit({ kind: true, id: true }),
      metadata: { behavior: managementBehavior, managementKind: 'application' },
      responses: { 200: receipt(view.ApplicationRecord) },
    },
  },
  connections: {
    list: {
      method: 'GET',
      path: '/api/v1/connections',
      query: PageQuery,
      metadata: { behavior: readBehavior },
      responses: { 200: page(ResourcePageSchemas.connections) },
    },
    replace: {
      method: 'PUT',
      path: '/api/v1/connections/:id',
      headers: RequestKeyHeaders,
      pathParams: z.object({ id: ResourceId }),
      body: ManagementCommand.options[1].omit({ kind: true, id: true }),
      metadata: { behavior: managementBehavior, managementKind: 'connection' },
      responses: { 200: receipt(view.ConnectionRecord) },
    },
  },
  credentials: {
    list: {
      method: 'GET',
      path: '/api/v1/credentials',
      query: PageQuery,
      metadata: { behavior: readBehavior },
      responses: { 200: page(ResourcePageSchemas.credentials) },
    },
    replace: {
      method: 'PUT',
      path: '/api/v1/credentials/:id',
      headers: RequestKeyHeaders,
      pathParams: z.object({ id: ResourceId }),
      body: ManagementCommand.options[2].omit({ kind: true, id: true }),
      metadata: { behavior: managementBehavior, managementKind: 'credential' },
      responses: { 200: receipt(view.CredentialRecord) },
    },
  },
  bindings: {
    list: {
      method: 'GET',
      path: '/api/v1/bindings',
      query: PageQuery,
      metadata: { behavior: readBehavior },
      responses: { 200: page(ResourcePageSchemas.bindings) },
    },
    replace: {
      method: 'PUT',
      path: '/api/v1/bindings/:id',
      headers: RequestKeyHeaders,
      pathParams: z.object({ id: z.uuid() }),
      body: ManagementCommand.options[3].omit({ kind: true, id: true }),
      metadata: { behavior: managementBehavior, managementKind: 'binding' },
      responses: { 200: receipt(view.BindingRecord) },
    },
  },
  profiles: {
    list: {
      method: 'GET',
      path: '/api/v1/profiles',
      query: PageQuery,
      metadata: { behavior: readBehavior },
      responses: { 200: page(ResourcePageSchemas.profiles) },
    },
    publish: {
      method: 'POST',
      path: '/api/v1/applications/:applicationId/profiles/:id/revisions',
      headers: RequestKeyHeaders,
      pathParams: z.object({ id: ResourceId, applicationId: ResourceId }),
      body: ManagementCommand.options[4].omit({
        kind: true,
        id: true,
        applicationId: true,
      }),
      metadata: { behavior: managementBehavior, managementKind: 'profile' },
      responses: { 200: receipt(view.ProfileRecord) },
    },
  },
  aliases: {
    list: {
      method: 'GET',
      path: '/api/v1/aliases',
      query: PageQuery,
      metadata: { behavior: readBehavior },
      responses: { 200: page(ResourcePageSchemas.aliases) },
    },
    replace: {
      method: 'PUT',
      path: '/api/v1/applications/:applicationId/profile-aliases/:id',
      headers: RequestKeyHeaders,
      pathParams: z.object({ id: ResourceId, applicationId: ResourceId }),
      body: ManagementCommand.options[5].omit({
        kind: true,
        id: true,
        applicationId: true,
      }),
      metadata: { behavior: managementBehavior, managementKind: 'alias' },
      responses: { 200: receipt(view.AliasRecord) },
    },
  },
  budgets: {
    list: {
      method: 'GET',
      path: '/api/v1/budgets',
      query: PageQuery,
      metadata: { behavior: readBehavior },
      responses: { 200: page(ResourcePageSchemas.budgets) },
    },
    replace: {
      method: 'PUT',
      path: '/api/v1/budgets/:id',
      headers: RequestKeyHeaders,
      pathParams: z.object({ id: ResourceId }),
      body: ManagementCommand.options[6].omit({ kind: true, id: true }),
      metadata: { behavior: managementBehavior, managementKind: 'budget' },
      responses: { 200: receipt(view.BudgetRecord) },
    },
  },
  pools: {
    list: {
      method: 'GET',
      path: '/api/v1/pools',
      query: PageQuery,
      metadata: { behavior: readBehavior },
      responses: { 200: page(ResourcePageSchemas.pools) },
    },
    replace: {
      method: 'PUT',
      path: '/api/v1/pools/:id',
      headers: RequestKeyHeaders,
      pathParams: z.object({ id: ResourceId }),
      body: ManagementCommand.options[7].omit({ kind: true, id: true }),
      metadata: { behavior: managementBehavior, managementKind: 'pool' },
      responses: { 200: receipt(view.PoolRecord) },
    },
  },
  runners: {
    list: {
      method: 'GET',
      path: '/api/v1/runners',
      query: PageQuery,
      metadata: { behavior: readBehavior },
      responses: { 200: page(ResourcePageSchemas.runners) },
    },
    lifecycle: {
      method: 'POST',
      path: '/api/v1/runners/:id/lifecycle',
      headers: RequestKeyHeaders,
      pathParams: z.object({ id: ResourceId }),
      body: ManagementCommand.options[8].omit({ kind: true, id: true }),
      metadata: { behavior: managementBehavior, managementKind: 'runner' },
      responses: { 200: receipt(view.RunnerRecord) },
    },
  },
  overview: {
    method: 'GET',
    path: '/api/v1/overview',
    metadata: { behavior: readBehavior },
    responses: { 200: Overview },
  },
  audit: {
    list: {
      method: 'GET',
      path: '/api/v1/audit',
      query: PageQuery,
      metadata: { behavior: readBehavior },
      responses: { 200: page(ResourcePageSchemas.audit) },
    },
  },
  outbox: {
    list: {
      method: 'GET',
      path: '/api/v1/outbox',
      query: PageQuery,
      metadata: { behavior: readBehavior },
      responses: { 200: page(ResourcePageSchemas.outbox) },
    },
  },
});
export type Overview = z.infer<typeof Overview>;
export type ResourcePages = {
  [K in ResourceName]: {
    items: z.infer<(typeof ResourcePageSchemas)[K]>[];
    nextCursor: string | null;
    limit: number;
    consistency: 'live-keyset';
  };
};
export type ManagementReceipt = {
  resource: view.ManagementResult;
  receipt: z.infer<typeof ReceiptInfo>;
};
