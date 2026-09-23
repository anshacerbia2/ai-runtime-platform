import { MatchersV3 as m } from '@pact-foundation/pact';
import type { createApiClient } from '../../apps/web/src/shared/api/api-client';

// Consumer-owned expectations: intentionally not generated from provider schemas.
// The client below is the same inferred client used by the console.
export const sampleId = '46a42625-8e98-4cc8-bb3b-c585a9b7f358';
export const input = {
  kind: 'chat' as const,
  payload: {
    profile: 'chat-default@1',
    input: {
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: 'Synthetic consumer test.' }],
        },
      ],
    },
  },
};
const chatProfile = {
  profile: 'chat-default@1',
  capability: 'chat',
  workload_class: 'interactive',
  execution_path: 'gateway',
  runtime_adapter: null,
  provider_adapter: 'openrouter',
  harness_ref: null,
  limits: { max_output_tokens: 2048, timeout_ms: 30000 },
  streaming: true,
  mode: 'contract-only',
  title: 'Direct chat',
  description: 'Consumer fixture',
};
const report = {
  valid: true,
  issues: [],
  profile: chatProfile,
  capability: 'chat',
  warnings: m.atLeastLike('Warning', 0),
  contract_version: m.like('test'),
};
const saved = {
  id: m.regex('[a-f0-9-]{36}', sampleId),
  application_id: m.like('consumer-app'),
  kind: 'chat',
  valid: true,
  report: m.like(report),
  created_at: m.like('2026-09-24T00:00:00.000Z'),
  request_summary: m.like({}),
  request_digest: m.like('a'.repeat(64)),
  contract_version: m.like('test'),
};
const health = {
  backend: 'ready',
  database: 'PostgreSQL',
  mode: 'contract-only',
  application_id: m.like('consumer-app'),
  saved_checks: m.integer(1),
  provider_calls: 0,
  contract_version: m.like('test'),
  framework: 'NestJS + Fastify',
  persistence: 'Prisma',
};
const application = {
  id: m.like('consumer-app'),
  displayName: m.like('Consumer fixture'),
  environment: m.like('local'),
  keycloakClientId: m.like('consumer-app'),
  status: 'ENABLED',
  revision: m.integer(1),
};
const snapshot = {
  applications: m.eachLike(application),
  connections: m.like([]),
  credentials: m.like([]),
  bindings: m.like([]),
  aliases: m.like([]),
  profiles: m.like([]),
  budgets: m.like([]),
  pools: m.like([]),
  runners: m.like([]),
};

type Client = ReturnType<typeof createApiClient>;
export interface ConsumerCase {
  name: string;
  path: string;
  method: 'GET' | 'POST';
  key?: string;
  body?: typeof input;
  status: number;
  expected: object;
  recordPath?: boolean;
  call(client: Client): Promise<{ status: number; body: unknown }>;
}
export const cases: ConsumerCase[] = [
  {
    name: 'health fields required by status cards',
    path: '/api/m0/health',
    method: 'GET',
    status: 200,
    expected: health,
    call: (c) => c.lab.health(),
  },
  {
    name: 'published profile selector',
    path: '/api/m0/profiles',
    method: 'GET',
    status: 200,
    expected: { items: m.eachLike(chatProfile) },
    call: (c) => c.lab.profiles(),
  },
  {
    name: 'example scenario catalogue',
    path: '/api/m0/examples',
    method: 'GET',
    status: 200,
    expected: {
      items: m.eachLike({
        id: m.like('chat'),
        title: m.like('Direct chat'),
        kind: m.like('chat'),
        payload: m.like({}),
      }),
    },
    call: (c) => c.lab.examples(),
  },
  {
    name: 'schema explorer catalogue',
    path: '/api/m0/contracts',
    method: 'GET',
    status: 200,
    expected: { version: m.like('test'), schemas: m.like({}) },
    call: (c) => c.lab.schemas(),
  },
  {
    name: 'durable history list',
    path: '/api/m0/history',
    method: 'GET',
    status: 200,
    expected: { items: m.eachLike(saved), next_cursor: null },
    call: (c) => c.lab.history({ query: {} }),
  },
  {
    name: 'durable history record',
    path: '/api/m0/history/' + sampleId,
    method: 'GET',
    status: 200,
    expected: saved,
    recordPath: true,
    call: (c) => c.lab.record({ params: { id: sampleId } }),
  },
  {
    name: 'new validation distinguishes creation from replay',
    path: '/api/m0/validations',
    method: 'POST',
    key: 'cdc-create',
    body: input,
    status: 201,
    expected: {
      ...saved,
      replayed: false,
      mode: 'contract-only',
      execution_created: false,
    },
    call: (c) =>
      c.lab.validate({
        body: input,
        headers: { 'idempotency-key': 'cdc-create' },
      }),
  },
  {
    name: 'validation replay returns its prior record',
    path: '/api/m0/validations',
    method: 'POST',
    key: 'cdc-replay',
    body: input,
    status: 200,
    expected: {
      ...saved,
      replayed: true,
      mode: 'contract-only',
      execution_created: false,
    },
    call: (c) =>
      c.lab.validate({
        body: input,
        headers: { 'idempotency-key': 'cdc-replay' },
      }),
  },
  {
    name: 'operator snapshot used by control plane',
    path: '/api/m1/control-plane',
    method: 'GET',
    status: 200,
    expected: snapshot,
    call: (c) => c.controlPlane.snapshot(),
  },
];
