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
const ResultProposal = z
  .object({
    outcome: z.enum(['completed', 'failed', 'cancelled']),
    digest: z.string().regex(/^[a-f0-9]{64}$/),
    artifactIds: z.array(z.uuid()).max(32),
    summary: z.string().max(2048),
  })
  .strict();
export const RunnerReport = z.discriminatedUnion('type', [
  z.object({ type: z.literal('started'), token: AssignmentToken }).strict(),
  z
    .object({
      type: z.literal('result.proposed'),
      token: AssignmentToken,
      proposal: ResultProposal,
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
export const runnerProtocol = {
  version: '1',
  binding: 'bounded-http-json',
  authority: 'durable-generation',
  maxMessageBytes: 65536,
  executionDispatch: false,
  automaticReassignment: false,
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
        executionDispatch: z.literal(false),
        automaticReassignment: z.literal(false),
      }),
    },
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
