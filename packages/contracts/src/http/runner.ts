import { initContract } from '@ts-rest/core';
import { z } from 'zod';
import { UsageCommand } from '../control-plane.js';
import {
  RequestKeyHeaders,
  ResourceId,
  managementBehavior,
} from './resources.js';
const c = initContract();
const generation = z.number().int().min(1).max(2147483646);
const registrationRevision = z.number().int().min(1).max(2147483646);
export const AssignmentToken = z
  .object({
    assignmentId: z.uuid(),
    executionId: z.uuid(),
    attemptId: z.uuid(),
    runnerId: ResourceId,
    generation,
    epoch: generation,
  })
  .strict();
export type AssignmentToken = z.infer<typeof AssignmentToken>;
export const Assignment = z.object({
  ...AssignmentToken.shape,
  ownerSubject: z.string(),
  state: z.enum(['GRANTED', 'STARTED', 'RESULT_PROPOSED', 'FENCED']),
  protocolVersion: z.literal('1'),
});
export type Assignment = z.infer<typeof Assignment>;
export const AssignCommand = z
  .object({
    attemptId: z.uuid(),
    runnerId: ResourceId,
    expectedGeneration: generation.or(z.literal(0)),
    protocolVersion: z.literal('1'),
  })
  .strict();
export type AssignCommand = z.infer<typeof AssignCommand>;
export const RevokeCommand = z
  .object({
    assignmentId: z.uuid(),
    generation,
    reason: z.string().min(1).max(500),
  })
  .strict();
export type RevokeCommand = z.infer<typeof RevokeCommand>;
export const RunnerLeaseIdentity = z
  .object({
    bootId: z.uuid(),
    registrationRevision,
    nonce: z.string().regex(/^[A-Za-z0-9_-]{32,128}$/),
  })
  .strict();
export type RunnerLeaseIdentity = z.infer<typeof RunnerLeaseIdentity>;
export const RunnerLeaseCommand = RunnerLeaseIdentity.extend({
  token: AssignmentToken,
}).strict();
export type RunnerLeaseCommand = z.infer<typeof RunnerLeaseCommand>;
export const RunnerOutcomeBinding = z
  .object({
    token: AssignmentToken,
    bootId: z.uuid(),
    registrationRevision,
  })
  .strict();
export type RunnerOutcomeBinding = z.infer<typeof RunnerOutcomeBinding>;
export const RunnerStopEvidence = z.discriminatedUnion('state', [
  z
    .object({
      state: z.literal('TERMINATED'),
      method: z.enum(['GRACEFUL', 'FORCED', 'OBSERVED']),
    })
    .strict(),
  z.object({ state: z.literal('UNCONFIRMED'), method: z.null() }).strict(),
]);
export const RunnerStopReport = RunnerOutcomeBinding.extend({
  evidence: RunnerStopEvidence,
}).strict();
export type RunnerStopReport = z.infer<typeof RunnerStopReport>;
export const RunnerStopReceipt = z.object({
  id: z.uuid(),
  binding: RunnerOutcomeBinding,
  evidence: RunnerStopEvidence,
  state: z.literal('QUARANTINED'),
  replayed: z.boolean(),
  stale: z.boolean(),
});
export type RunnerStopReceipt = z.infer<typeof RunnerStopReceipt>;
export const RunnerResultReconciliationRequest = RunnerOutcomeBinding.extend({
  proposalDigest: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type RunnerResultReconciliationRequest = z.infer<
  typeof RunnerResultReconciliationRequest
>;
export const RunnerResultReconciliation = z.object({
  binding: RunnerOutcomeBinding,
  proposalDigest: z.string().regex(/^[a-f0-9]{64}$/),
  state: z.enum(['MATCHED', 'NOT_RECORDED', 'CONFLICT']),
  stale: z.boolean(),
});
export type RunnerResultReconciliation = z.infer<
  typeof RunnerResultReconciliation
>;
export const RunnerPayloadHandoffCommand = RunnerLeaseCommand.extend({
  envelopeId: z.uuid(),
}).strict();
export type RunnerPayloadHandoffCommand = z.infer<
  typeof RunnerPayloadHandoffCommand
>;
/** Draft machine-only binary contract; not registered in the production API. */
export const runnerPayloadHandoffContract = c.router({
  payload: {
    method: 'POST',
    path: '/api/runner/v1/dispatches/payload',
    headers: z.object({ 'x-runner-protocol': z.literal('1') }),
    body: RunnerPayloadHandoffCommand,
    metadata: {
      responseMode: 'binary',
      behavior: { replay: 'none', maxAttempts: 1, maxResponseBytes: 1_048_576 },
    },
    responses: {
      200: c.otherResponse({
        contentType: 'application/octet-stream',
        body: c.type<Uint8Array>(),
      }),
    },
  },
});
/** Draft verified package handoff; kept outside the production API contract. */
export const runnerPluginHandoffContract = c.router({
  plugin: {
    method: 'POST',
    path: '/api/runner/v1/dispatches/plugin',
    headers: z.object({ 'x-runner-protocol': z.literal('1') }),
    body: RunnerPayloadHandoffCommand,
    metadata: {
      responseMode: 'binary',
      behavior: {
        replay: 'none',
        maxAttempts: 1,
        maxResponseBytes: 16_777_216,
      },
    },
    responses: {
      200: c.otherResponse({
        contentType: 'application/octet-stream',
        body: c.type<Uint8Array>(),
      }),
    },
  },
});
export const RunnerLeaseAck = z
  .object({
    state: z.literal('ACTIVE'),
    leaseTtlMs: z.literal(15000),
    renewIntervalMs: z.literal(5000),
  })
  .strict();
export type RunnerLeaseAck = z.infer<typeof RunnerLeaseAck>;
const ResultProposal = z
  .object({
    outcome: z.enum(['completed', 'failed', 'cancelled']),
    digest: z.string().regex(/^[a-f0-9]{64}$/),
    artifactIds: z.array(z.uuid()).max(32),
    summary: z.string().max(2048),
  })
  .strict();
export const RunnerReport = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('started'),
      token: AssignmentToken,
      lease: RunnerLeaseIdentity.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('result.proposed'),
      token: AssignmentToken,
      proposal: ResultProposal,
      lease: RunnerLeaseIdentity.optional(),
    })
    .strict(),
]);
export type RunnerReport = z.infer<typeof RunnerReport>;
export const LateEvidence = z
  .object({ token: AssignmentToken, evidence: UsageCommand })
  .strict();
export type LateEvidence = z.infer<typeof LateEvidence>;
export const EvidenceReceipt = z.object({
  id: z.uuid(),
  state: z.literal('QUARANTINED'),
  replayed: z.boolean(),
  stale: z.boolean(),
});
export type EvidenceReceipt = z.infer<typeof EvidenceReceipt>;
export const RunnerHeartbeat = z
  .object({
    runnerId: ResourceId,
    bootId: z.uuid(),
    registrationRevision,
  })
  .strict();
export type RunnerHeartbeat = z.infer<typeof RunnerHeartbeat>;
export const RunnerHeartbeatAck = z.object({
  runnerId: ResourceId,
  bootId: z.uuid(),
  registrationRevision,
  state: z.literal('ALIVE'),
  heartbeatIntervalMs: z.literal(5000),
  presenceTtlMs: z.literal(15000),
});
export type RunnerHeartbeatAck = z.infer<typeof RunnerHeartbeatAck>;
export const RunnerDispatchGrant = Assignment.extend({
  state: z.literal('GRANTED'),
  envelopeId: z.uuid(),
  inputDigest: z.string().regex(/^[a-f0-9]{64}$/),
  plaintextBytes: z.number().int().min(1).max(1_048_576),
  expiresAt: z.iso.datetime({ offset: true }),
  plugin: z
    .object({
      packageId: ResourceId,
      version: ResourceId,
      bundleDigest: z.string().regex(/^[a-f0-9]{64}$/),
      runtimeVersion: ResourceId,
      requiredPermissions: z.array(ResourceId).max(64),
    })
    .strict()
    .nullable(),
}).strict();
export type RunnerDispatchGrant = z.infer<typeof RunnerDispatchGrant>;
export const RunnerDispatchClaimResult = z
  .object({
    grant: RunnerDispatchGrant.nullable(),
  })
  .strict();
export type RunnerDispatchClaimResult = z.infer<
  typeof RunnerDispatchClaimResult
>;
export const runnerProtocol = {
  version: '1',
  binding: 'bounded-http-json',
  authority: 'durable-generation',
  maxMessageBytes: 65536,
  executionDispatch: true,
  automaticReassignment: false,
  heartbeatIntervalMs: 5000,
  presenceTtlMs: 15000,
} as const;
export const runnerContract = c.router({
  protocol: {
    method: 'GET',
    path: '/api/runner/v1/protocol',
    responses: {
      200: z.object({
        version: z.literal('1'),
        binding: z.literal('bounded-http-json'),
        authority: z.literal('durable-generation'),
        maxMessageBytes: z.literal(65536),
        executionDispatch: z.literal(true),
        automaticReassignment: z.literal(false),
        heartbeatIntervalMs: z.literal(5000),
        presenceTtlMs: z.literal(15000),
      }),
    },
  },
  heartbeat: {
    method: 'POST',
    path: '/api/runner/v1/heartbeat',
    headers: z.object({ 'x-runner-protocol': z.literal('1') }),
    body: RunnerHeartbeat,
    responses: { 200: RunnerHeartbeatAck },
  },
  claimDispatch: {
    method: 'POST',
    path: '/api/runner/v1/dispatches/claim',
    headers: z.object({ 'x-runner-protocol': z.literal('1') }),
    body: RunnerHeartbeat,
    metadata: {
      behavior: { replay: 'none', maxAttempts: 1, maxResponseBytes: 65_536 },
    },
    responses: { 200: RunnerDispatchClaimResult },
  },
  activateLease: {
    method: 'POST',
    path: '/api/runner/v1/leases/activate',
    headers: z.object({ 'x-runner-protocol': z.literal('1') }),
    body: RunnerLeaseCommand,
    metadata: {
      behavior: { replay: 'none', maxAttempts: 1, maxResponseBytes: 65_536 },
    },
    responses: { 200: RunnerLeaseAck },
  },
  report: {
    method: 'POST',
    path: '/api/runner/v1/reports',
    headers: z.object({ 'x-runner-protocol': z.literal('1') }),
    body: RunnerReport,
    responses: { 200: Assignment },
  },
  evidence: {
    method: 'POST',
    path: '/api/runner/v1/evidence',
    headers: z.object({ 'x-runner-protocol': z.literal('1') }),
    body: LateEvidence,
    responses: { 202: EvidenceReceipt },
  },
  stop: {
    method: 'POST',
    path: '/api/runner/v1/stops',
    headers: z.object({ 'x-runner-protocol': z.literal('1') }),
    body: RunnerStopReport,
    metadata: {
      behavior: { replay: 'none', maxAttempts: 1, maxResponseBytes: 65_536 },
    },
    responses: { 202: RunnerStopReceipt },
  },
  reconcileResult: {
    method: 'POST',
    path: '/api/runner/v1/results/reconcile',
    headers: z.object({ 'x-runner-protocol': z.literal('1') }),
    body: RunnerResultReconciliationRequest,
    metadata: {
      behavior: { replay: 'none', maxAttempts: 1, maxResponseBytes: 65_536 },
    },
    responses: { 200: RunnerResultReconciliation },
  },
});
export const assignmentContract = c.router({
  grant: {
    method: 'POST',
    path: '/api/v1/executions/:id/assignments',
    headers: RequestKeyHeaders,
    pathParams: z.object({ id: z.uuid() }),
    body: AssignCommand,
    metadata: { behavior: managementBehavior },
    responses: { 200: Assignment },
  },
  revoke: {
    method: 'POST',
    path: '/api/v1/executions/:id/assignments/revoke',
    headers: RequestKeyHeaders,
    pathParams: z.object({ id: z.uuid() }),
    body: RevokeCommand,
    metadata: { behavior: managementBehavior },
    responses: { 200: Assignment },
  },
});
