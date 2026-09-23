import { initContract, type AppRoute } from '@ts-rest/core';
import { z } from 'zod';
import { ValidationInput } from '../validation/types.js';
import {
  AdmissionCommand,
  ArtifactCommand,
  ManagementCommand,
  RunnerRegistration,
  UsageCommand,
} from '../control-plane.js';
import * as lab from './lab.js';
import * as control from './control-plane.js';

const c = initContract();

export const HttpErrorPayload = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  retryable: z.boolean().optional(),
  fields: z.record(z.string(), z.string()).optional(),
  details: z.unknown().optional(),
  request_id: z.string().optional(),
  execution_id: z.string().nullable().optional(),
});
export const HttpErrorResponse = z.object({ error: HttpErrorPayload });
export type ApiErrorPayload = z.infer<typeof HttpErrorPayload>;
export type ApiErrorResponse = z.infer<typeof HttpErrorResponse>;

export const errorResponses = {
  400: HttpErrorResponse,
  401: HttpErrorResponse,
  402: HttpErrorResponse,
  403: HttpErrorResponse,
  404: HttpErrorResponse,
  405: HttpErrorResponse,
  408: HttpErrorResponse,
  409: HttpErrorResponse,
  410: HttpErrorResponse,
  413: HttpErrorResponse,
  415: HttpErrorResponse,
  422: HttpErrorResponse,
  429: HttpErrorResponse,
  500: HttpErrorResponse,
  502: HttpErrorResponse,
  503: HttpErrorResponse,
  504: HttpErrorResponse,
};
const keyHeaders = z.object({ 'idempotency-key': z.string().min(1).max(160) });
const uuidParams = z.object({ id: z.string().uuid() });
export const HistoryQuery = z
  .object({
    limit: z
      .string()
      .regex(/^[0-9]{1,3}$/)
      .optional(),
    cursor: z.string().min(1).max(512).optional(),
  })
  .strict();

export const apiContract = c.router(
  {
    live: {
      method: 'GET',
      path: '/health/live',
      responses: {
        200: z.object({
          status: z.literal('ok'),
          milestone: z.literal('M0'),
          mode: z.literal('contract-only'),
        }),
      },
    },
    lab: {
      health: {
        method: 'GET',
        path: '/api/m0/health',
        responses: { 200: lab.LabHealth },
      },
      profiles: {
        method: 'GET',
        path: '/api/m0/profiles',
        responses: { 200: lab.LabProfiles },
      },
      examples: {
        method: 'GET',
        path: '/api/m0/examples',
        responses: { 200: lab.LabExamples },
      },
      schemas: {
        method: 'GET',
        path: '/api/m0/contracts',
        responses: { 200: lab.LabSchemas },
      },
      openapi: {
        method: 'GET',
        path: '/api/m0/openapi.json',
        responses: { 200: lab.OpenApiDocument },
      },
      validate: {
        method: 'POST',
        path: '/api/m0/validations',
        headers: keyHeaders,
        body: ValidationInput,
        responses: { 200: lab.ValidationResult, 201: lab.ValidationResult },
      },
      history: {
        method: 'GET',
        path: '/api/m0/history',
        query: HistoryQuery,
        responses: { 200: lab.LabHistory },
      },
      record: {
        method: 'GET',
        path: '/api/m0/history/:id',
        metadata: { invalidPathIsNotFound: true },
        pathParams: uuidParams,
        responses: { 200: lab.SavedValidation },
      },
    },
    controlPlane: {
      snapshot: {
        method: 'GET',
        path: '/api/m1/control-plane',
        responses: { 200: control.ControlSnapshot },
      },
      manage: {
        method: 'PUT',
        path: '/api/m1/control-plane',
        body: ManagementCommand,
        responses: { 200: control.ManagementResult },
      },
      admit: {
        method: 'POST',
        path: '/api/m1/admissions',
        headers: keyHeaders,
        body: AdmissionCommand,
        responses: {
          200: control.AdmissionResult,
          201: control.AdmissionResult,
        },
      },
      execution: {
        method: 'GET',
        path: '/api/m1/executions/:id',
        pathParams: uuidParams,
        responses: { 200: control.ExecutionView },
      },
      cancel: {
        method: 'POST',
        path: '/api/m1/executions/:id/cancel',
        pathParams: uuidParams,
        body: z
          .object({ reason: z.string().min(1).max(500).optional() })
          .strict(),
        responses: { 201: control.ExecutionView },
      },
      usage: {
        method: 'POST',
        path: '/api/m1/usage',
        body: UsageCommand,
        responses: { 201: control.UsageResult },
      },
      artifact: {
        method: 'POST',
        path: '/api/m1/artifacts',
        body: ArtifactCommand,
        responses: { 201: control.ArtifactRecord },
      },
      registerRunner: {
        method: 'POST',
        path: '/api/m1/runners/register',
        body: RunnerRegistration,
        responses: { 201: control.RunnerRecord },
      },
      inbox: {
        method: 'POST',
        path: '/api/m1/inbox/:consumer/:eventId',
        body: c.noBody(),
        pathParams: z.object({
          consumer: z.string().min(1).max(120),
          eventId: z.uuid(),
        }),
        responses: { 201: z.object({ replayed: z.boolean() }) },
      },
      audit: {
        method: 'GET',
        path: '/api/m1/audit',
        query: z.object({ application_id: z.string().optional() }).strict(),
        responses: { 200: z.array(control.AuditRecord) },
      },
      outbox: {
        method: 'GET',
        path: '/api/m1/outbox',
        responses: { 200: z.array(control.OutboxRecord) },
      },
    },
  },
  { strictStatusCodes: true, commonResponses: errorResponses },
);

/** Explicit exposure policy: machine-only routes never become browser routes automatically. */
export const browserContract = c.router({
  lab: apiContract.lab,
  controlPlane: {
    snapshot: apiContract.controlPlane.snapshot,
    manage: apiContract.controlPlane.manage,
    admit: apiContract.controlPlane.admit,
    execution: apiContract.controlPlane.execution,
    cancel: apiContract.controlPlane.cancel,
    usage: apiContract.controlPlane.usage,
    artifact: apiContract.controlPlane.artifact,
    audit: apiContract.controlPlane.audit,
    outbox: apiContract.controlPlane.outbox,
  },
});

export function contractRoutes(value: object): AppRoute[] {
  return Object.values(value).flatMap((entry) =>
    entry && typeof entry === 'object' && 'method' in entry && 'path' in entry
      ? [entry as AppRoute]
      : contractRoutes(entry),
  );
}

export function matchRoute(
  routes: readonly AppRoute[],
  pathname: string,
): AppRoute[] {
  return routes.filter((route) => {
    const expected = route.path.split('/');
    const actual = pathname.split('/');
    return (
      expected.length === actual.length &&
      expected.every((part, index) =>
        part.startsWith(':')
          ? /^[A-Za-z0-9_.:-]+$/.test(actual[index] ?? '')
          : part === actual[index],
      )
    );
  });
}

export function responseSchema(
  route: AppRoute,
  status: number,
): z.ZodType | undefined {
  const schema = route.responses[status];
  return schema instanceof z.ZodType ? schema : undefined;
}
