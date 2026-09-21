import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { ChatRequest, examples, type CheckResult } from '@ai-runtime/contracts';
import { createApplication } from '../dist/bootstrap.js';
import { loadConfig } from '../src/infrastructure/config/local-config.js';
import { createDatabaseClient } from '../src/infrastructure/database/client.js';
import { seedDatabase } from '../src/infrastructure/database/seed.js';

const config = loadConfig();
const database = createDatabaseClient(config.databaseUrl);
let application: Awaited<ReturnType<typeof createApplication>>;
let http: FastifyInstance;
const applicationId = config.applications[0]!.id;
const headers = {
  authorization: `Bearer ${config.applications[0]!.token}`,
  host: '127.0.0.1:4311',
};
const otherHeaders = {
  authorization: `Bearer ${config.applications[1]!.token}`,
  host: '127.0.0.1:4311',
};
const body = {
  kind: 'chat',
  payload: ChatRequest.parse(
    examples.find((example) => example.id === 'chat')!.payload,
  ),
};
const keys: string[] = [];

interface SavedResponse {
  id: string;
  valid: boolean;
  execution_created: boolean;
  replayed: boolean;
  report: CheckResult;
}
interface HistoryResponse {
  items: SavedResponse[];
  next_cursor: string | null;
}

function key(): string {
  const value = `test-refactor-${randomUUID()}`;
  keys.push(value);
  return value;
}

function post(
  idempotencyKey: string,
  payload: InjectOptions['payload'] = body,
) {
  return http.inject({
    method: 'POST',
    url: '/api/m0/validations',
    headers: { ...headers, 'idempotency-key': idempotencyKey },
    payload,
  });
}

before(async () => {
  await seedDatabase(database, config);
  application = await createApplication(config);
  http = application.getHttpAdapter().getInstance() as FastifyInstance;
});

after(async () => {
  await application?.close();
  await database.contractCheck.deleteMany({
    where: { applicationId, idempotencyKey: { in: keys } },
  });
  await database.$disconnect();
});

test('NestJS/Fastify health depends on real PostgreSQL', async () => {
  const response = await http.inject({ url: '/api/m0/health', headers });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().database, 'PostgreSQL');
});

test('missing credentials rejected', async () => {
  const response = await http.inject({
    url: '/api/m0/history',
    headers: { host: '127.0.0.1' },
  });
  assert.equal(response.statusCode, 401);
  assert.equal(response.json().error.code, 'UNAUTHENTICATED');
});

test('cross-origin request rejected', async () => {
  const response = await http.inject({
    url: '/api/m0/history',
    headers: { ...headers, origin: 'https://evil.invalid' },
  });
  assert.equal(response.statusCode, 403);
});

test('DNS rebinding host rejected', async () => {
  const response = await http.inject({
    url: '/api/m0/history',
    headers: { ...headers, host: 'attacker.invalid' },
  });
  assert.equal(response.statusCode, 403);
});

test('Prisma repository persists, replays, detects conflict, and isolates applications', async () => {
  const idempotencyKey = key();
  const first = await post(idempotencyKey);
  const saved = first.json<SavedResponse>();
  assert.equal(first.statusCode, 201);
  assert.equal(saved.valid, true);
  assert.equal(saved.execution_created, false);
  const replay = await post(idempotencyKey);
  assert.equal(replay.statusCode, 200);
  assert.equal(replay.json<SavedResponse>().id, saved.id);
  const changed = structuredClone(body);
  changed.payload.stream = false;
  const conflict = await post(idempotencyKey, changed);
  assert.equal(conflict.statusCode, 409);
  assert.equal(conflict.json().error.code, 'IDEMPOTENCY_CONFLICT');
  const hidden = await http.inject({
    url: `/api/m0/history/${saved.id}`,
    headers: otherHeaders,
  });
  assert.equal(hidden.statusCode, 404);
  assert.equal(
    await database.contractCheck.count({
      where: { applicationId, idempotencyKey },
    }),
    1,
  );
});

test('20 concurrent duplicate validations create exactly one record', async () => {
  const idempotencyKey = key();
  const responses = await Promise.all(
    Array.from({ length: 20 }, () => post(idempotencyKey)),
  );
  assert.equal(
    responses.filter((response) => response.statusCode === 201).length,
    1,
  );
  assert.equal(
    responses.filter((response) => response.statusCode === 200).length,
    19,
  );
  assert.equal(
    new Set(responses.map((response) => response.json<SavedResponse>().id))
      .size,
    1,
  );
  assert.equal(
    await database.contractCheck.count({
      where: { applicationId, idempotencyKey },
    }),
    1,
  );
});

test('invalid caller authority produces a stored report, not an AI execution', async () => {
  const response = await post(key(), {
    kind: 'chat',
    payload: examples.find((example) => example.id === 'invalid')!.payload,
  });
  assert.equal(response.statusCode, 201);
  const saved = response.json<SavedResponse>();
  assert.equal(saved.valid, false);
  assert.equal(saved.execution_created, false);
});

test('raw prompts are not persisted by the Prisma adapter', async () => {
  const fixture = structuredClone(body);
  const secret = `SYNTHETIC_DO_NOT_PERSIST_${randomUUID()}`;
  fixture.payload.input.messages = [
    { role: 'user', content: [{ type: 'text', text: secret }] },
  ];
  const response = await post(key(), fixture);
  const row = await database.contractCheck.findUniqueOrThrow({
    where: { id: response.json<SavedResponse>().id },
  });
  assert.equal(JSON.stringify(row).includes(secret), false);
});

test('malformed JSON returns the normalized error envelope', async () => {
  const response = await http.inject({
    method: 'POST',
    url: '/api/m0/validations',
    headers: {
      ...headers,
      'content-type': 'application/json',
      'idempotency-key': key(),
    },
    payload: '{bad',
  });
  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error.code, 'INVALID_REQUEST');
});

test('payload is bounded before validation', async () => {
  const response = await post(key(), {
    kind: 'chat',
    payload: 'x'.repeat(70000),
  });
  assert.equal(response.statusCode, 413);
});

test('history validates limits and opaque cursors', async () => {
  assert.equal(
    (await http.inject({ url: '/api/m0/history?limit=999', headers }))
      .statusCode,
    400,
  );
  assert.equal(
    (await http.inject({ url: '/api/m0/history?cursor=bad', headers }))
      .statusCode,
    400,
  );
  const first = (
    await http.inject({ url: '/api/m0/history?limit=1', headers })
  ).json<HistoryResponse>();
  assert.equal(first.items.length, 1);
  assert.ok(first.next_cursor);
  const second = (
    await http.inject({
      url: `/api/m0/history?limit=1&cursor=${encodeURIComponent(first.next_cursor)}`,
      headers,
    })
  ).json<HistoryResponse>();
  assert.notEqual(first.items[0]!.id, second.items[0]!.id);
});

test('Prisma migrate deploy and seed replay do not lose history', async () => {
  const saved = (await post(key())).json<SavedResponse>();
  execFileSync(process.execPath, [resolve('scripts/database/migrate.mjs')], {
    cwd: process.cwd(),
    stdio: 'pipe',
  });
  assert.equal(
    (await http.inject({ url: `/api/m0/history/${saved.id}`, headers }))
      .statusCode,
    200,
  );
});

test('a second Nest application observes committed database records', async () => {
  const saved = (await post(key())).json<SavedResponse>();
  const another = await createApplication(config);
  try {
    const transport = another.getHttpAdapter().getInstance() as FastifyInstance;
    const response = await transport.inject({
      url: `/api/m0/history/${saved.id}`,
      headers,
    });
    assert.equal(response.json<SavedResponse>().id, saved.id);
  } finally {
    await another.close();
  }
});

test('planned execution routes cannot call any provider', async () => {
  const response = await http.inject({
    method: 'POST',
    url: '/v1/executions',
    headers,
    payload: {},
  });
  assert.equal(response.statusCode, 404);
  assert.equal(response.json().error.code, 'NOT_FOUND');
});

test('deep diagnostic input rejected before hashing', async () => {
  let nested: Record<string, unknown> = {};
  for (let index = 0; index < 40; index += 1) {
    nested = { child: nested };
  }
  const response = await post(key(), { kind: 'chat', payload: nested });
  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error.code, 'INVALID_REQUEST');
});

test('malformed UUID cannot reach a PostgreSQL cast error', async () => {
  const response = await http.inject({
    url: `/api/m0/history/${'-'.repeat(36)}`,
    headers,
  });
  assert.equal(response.statusCode, 404);
});

test('cursor ownership is enforced before pagination', async () => {
  const saved = (await post(key())).json<SavedResponse>();
  const cursor = Buffer.from(
    JSON.stringify({ version: 1, id: saved.id }),
  ).toString('base64url');
  const response = await http.inject({
    url: `/api/m0/history?cursor=${cursor}`,
    headers: otherHeaders,
  });
  assert.equal(response.statusCode, 400);
});

test('cursor pagination preserves PostgreSQL microsecond ordering', async () => {
  const first = (await post(key())).json<SavedResponse>();
  const second = (await post(key())).json<SavedResponse>();
  // Test fixture SQL only. Runtime repositories do not round timestamp cursors.
  await database.$executeRaw`UPDATE m0.contract_checks SET created_at = '2099-01-01T00:00:00.000001Z'::timestamptz WHERE id = ${first.id}::uuid`;
  await database.$executeRaw`UPDATE m0.contract_checks SET created_at = '2099-01-01T00:00:00.000002Z'::timestamptz WHERE id = ${second.id}::uuid`;
  const page = (
    await http.inject({ url: '/api/m0/history?limit=1', headers })
  ).json<HistoryResponse>();
  assert.equal(page.items[0]!.id, second.id);
  const next = (
    await http.inject({
      url: `/api/m0/history?limit=1&cursor=${encodeURIComponent(page.next_cursor!)}`,
      headers,
    })
  ).json<HistoryResponse>();
  assert.equal(next.items[0]!.id, first.id);
});

test('public liveness does not require application credentials', async () => {
  const response = await http.inject({
    url: '/health/live',
    headers: { host: '127.0.0.1' },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().mode, 'contract-only');
});

for (const constraint of ['kind', 'idempotency-key-length'] as const) {
  test(`legacy PostgreSQL CHECK remains enforced: ${constraint}`, async () => {
    const idempotencyKey =
      constraint === 'idempotency-key-length'
        ? `${key()}${'x'.repeat(160)}`
        : key();
    keys.push(idempotencyKey);
    await assert.rejects(
      database.contractCheck.create({
        data: {
          id: randomUUID(),
          applicationId,
          idempotencyKey,
          requestDigest: '0'.repeat(64),
          contractVersion: 'constraint-test',
          kind: constraint === 'kind' ? 'unsupported-kind' : 'chat',
          valid: false,
          requestSummary: {},
          report: {},
        },
      }),
      /constraint|check/i,
    );
    assert.equal(
      await database.contractCheck.count({
        where: { applicationId, idempotencyKey },
      }),
      0,
    );
  });
}
