import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { schemaBundle, CONTRACT_VERSION } from '@ai-runtime/contracts';
import { resolve } from 'node:path';
const security = [{ localBearer: [] }];
const ok = { description: 'Successful local contract-lab response' };
const ref = (name: string) => ({ $ref: '#/components/schemas/' + name });
const lab = {
  openapi: '3.1.0',
  info: {
    title: 'AI Runtime Platform — M0 Contract Lab',
    version: CONTRACT_VERSION,
    description:
      'Local-only schema validation and metadata persistence. NO provider calls, execution scheduling, budget ledger, or production authentication.',
  },
  servers: [{ url: 'http://127.0.0.1:4311' }],
  security,
  paths: {
    '/health/live': { get: { security: [], responses: { '200': ok } } },
    '/api/m0/health': {
      get: {
        responses: {
          '200': ok,
          '503': { description: 'Database unavailable' },
        },
      },
    },
    '/api/m0/profiles': { get: { responses: { '200': ok } } },
    '/api/m0/examples': { get: { responses: { '200': ok } } },
    '/api/m0/contracts': { get: { responses: { '200': ok } } },
    '/api/m0/openapi.json': { get: { responses: { '200': ok } } },
    '/api/m0/validations': {
      post: {
        parameters: [
          {
            name: 'Idempotency-Key',
            in: 'header',
            required: true,
            schema: { type: 'string', minLength: 1, maxLength: 160 },
          },
        ],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: ref('ValidationInput') } },
        },
        responses: {
          '201': {
            description: 'Validation metadata persisted, not an AI execution',
          },
          '200': { description: 'Idempotent replay of prior validation' },
          '400': { description: 'Malformed lab envelope' },
          '401': { description: 'Unauthenticated' },
          '409': { description: 'Same key, different request digest' },
          '503': {
            description: 'Persistence unavailable; no successful save claimed',
          },
        },
      },
    },
    '/api/m0/history': {
      get: {
        parameters: [
          {
            name: 'limit',
            in: 'query',
            schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
          },
          { name: 'cursor', in: 'query', schema: { type: 'string' } },
        ],
        responses: { '200': ok },
      },
    },
    '/api/m0/history/{id}': {
      get: {
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: {
          '200': ok,
          '404': { description: 'Record absent or belongs to another app' },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      localBearer: {
        type: 'http',
        scheme: 'bearer',
        description:
          'Generated local app credential; BFF injects it, never exposed to browser.',
      },
    },
    schemas: schemaBundle,
  },
};
const idempotencyHeader = {
  name: 'Idempotency-Key',
  in: 'header',
  required: true,
  schema: { type: 'string', minLength: 1, maxLength: 160 },
};
const executionId = {
  name: 'id',
  in: 'path',
  required: true,
  schema: { type: 'string' },
};
const responseHeaders = {
  'X-Request-ID': { schema: { type: 'string' } },
  'X-Execution-ID': { schema: { type: 'string' } },
};
const snapshotResponse = {
  description: 'Planned authoritative execution snapshot; not served by M0',
  headers: responseHeaders,
  content: { 'application/json': { schema: ref('Snapshot') } },
};
const normalizedError = {
  description:
    'Normalized error; authorization and admission failures do not execute AI',
  content: { 'application/json': { schema: ref('ErrorEnvelope') } },
};
const streamResponse = {
  description:
    'Planned SSE frames; terminal result remains in the authoritative snapshot',
  content: { 'text/event-stream': { schema: { type: 'string' } } },
};
const plannedPaths: Record<string, unknown> = Object.fromEntries(
  [
    ['/v1/chat', 'ChatRequest'],
    ['/v1/generate', 'GenerateRequest'],
    ['/v1/executions', 'ExecutionRequest'],
  ].map(([path, name]) => [
    path!,
    {
      post: {
        'x-implementation-status': 'PLANNED',
        parameters: [
          idempotencyHeader,
          {
            name: 'traceparent',
            in: 'header',
            required: false,
            schema: { type: 'string' },
          },
        ],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: ref(name!) } },
        },
        responses:
          path === '/v1/executions'
            ? {
                '202': {
                  ...snapshotResponse,
                  headers: {
                    ...responseHeaders,
                    Location: { schema: { type: 'string' } },
                  },
                },
                default: normalizedError,
              }
            : {
                '200': {
                  ...snapshotResponse,
                  content: {
                    ...snapshotResponse.content,
                    ...streamResponse.content,
                  },
                },
                default: normalizedError,
              },
      },
    },
  ]),
);
plannedPaths['/v1/executions/{id}'] = {
  get: {
    parameters: [executionId],
    responses: {
      '200': snapshotResponse,
      '404': normalizedError,
      default: normalizedError,
    },
  },
};
plannedPaths['/v1/executions/{id}/events'] = {
  get: {
    parameters: [
      executionId,
      {
        name: 'Last-Event-ID',
        in: 'header',
        required: false,
        schema: { type: 'string' },
      },
    ],
    responses: {
      '200': streamResponse,
      '410': {
        description:
          'Replay cursor expired; authorized snapshot link is returned. Reconnect never starts inference.',
        content: { 'application/json': { schema: ref('ErrorEnvelope') } },
      },
      default: normalizedError,
    },
  },
};
plannedPaths['/v1/executions/{id}/cancel'] = {
  post: {
    parameters: [executionId],
    requestBody: {
      required: false,
      content: { 'application/json': { schema: ref('CancelRequest') } },
    },
    responses: {
      '202': {
        ...snapshotResponse,
        description:
          'Durable cancellation requested; not proof that upstream activity stopped',
      },
      '200': {
        ...snapshotResponse,
        description: 'Execution was already terminal',
      },
      default: normalizedError,
    },
  },
};
const target = {
  openapi: '3.1.0',
  info: {
    title: 'AI Runtime v1 — PLANNED execution API',
    version: CONTRACT_VERSION,
    description:
      'Machine-readable contract draft. Covers submission, snapshot, cancellation and event-stream envelopes only. List, usage, capability discovery and artifact endpoints remain in the design specification. NO /v1 routes are implemented by M0. Production identity, admission, replay and state gates remain required.',
  },
  'x-implementation-status': 'PLANNED',
  security: [{ applicationBearer: [] }],
  paths: plannedPaths,
  components: {
    securitySchemes: {
      applicationBearer: {
        type: 'http',
        scheme: 'bearer',
        description:
          'Platform application/delegated credential, never an AI provider key. Issuer and deployment binding require review.',
      },
    },
    schemas: schemaBundle,
  },
};
const files = {
  'schemas.json': { contract_version: CONTRACT_VERSION, schemas: schemaBundle },
  'm0.openapi.json': lab,
  'execution-v1.planned.openapi.json': target,
};
mkdirSync('contracts', { recursive: true });
for (const [name, value] of Object.entries(files)) {
  const path = resolve('contracts', name);
  const content = JSON.stringify(value, null, 2) + '\n';
  if (process.argv.includes('--check')) {
    if (!existsSync(path) || readFileSync(path, 'utf8') !== content) {
      throw new Error(
        'Contract drift: ' + name + '; run npm run contracts:export',
      );
    }
  } else {
    writeFileSync(path, content);
  }
}
console.log(
  process.argv.includes('--check')
    ? 'Contract exports match source.'
    : 'Exported schema bundle, M0 API, and explicitly planned v1 API.',
);
