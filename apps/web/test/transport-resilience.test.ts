import assert from 'node:assert/strict';
import test from 'node:test';
import {
  apiContract,
  browserContract,
  httpBehavior,
  httpOpenApi,
} from '@ai-runtime/contracts/http';
import { createApiClient } from '../src/shared/api/api-client';
import { ApiClientError, retryAfterMs } from '../src/shared/api/http-error';
import {
  completeMutation,
  type MutationState,
} from '../src/shared/api/mutation-state';

const health = {
  backend: 'ready',
  database: 'PostgreSQL',
  mode: 'contract-only',
  application_id: 'test',
  saved_checks: 1,
  provider_calls: 0,
  contract_version: 'test',
  framework: 'NestJS',
  persistence: 'Prisma',
};
const isCode = (code: string) => (e: unknown) =>
  e instanceof ApiClientError && e.code === code;

test(
  'deadline terminates a non-cooperative transport without retrying',
  { timeout: 2000 },
  async () => {
    let calls = 0;
    let signal: AbortSignal | null | undefined;
    const client = createApiClient(
      (_url, init) => {
        calls++;
        signal = init?.signal;
        return new Promise<Response>(() => {});
      },
      { timeoutMs: 200 },
    );
    await assert.rejects(client.lab.health(), isCode('REQUEST_TIMEOUT'));
    assert.equal(calls, 1);
    assert.equal(signal?.aborted, true);
  },
);

test(
  'body deadline cannot hang on an uncooperative stream cancellation',
  { timeout: 2000 },
  async () => {
    let cancelled = false;
    const client = createApiClient(
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            cancel() {
              cancelled = true;
              return new Promise<void>(() => {});
            },
          }),
          { headers: { 'Content-Type': 'application/json' } },
        ),
      { timeoutMs: 200 },
    );
    await assert.rejects(client.lab.health(), isCode('REQUEST_TIMEOUT'));
    assert.equal(cancelled, true);
  },
);

test('pre-aborted calls never contact transport and are explicitly not sent', async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  const client = createApiClient(async () => {
    calls++;
    return Response.json(health);
  });
  await assert.rejects(
    client.lab.health({ fetchOptions: { signal: controller.signal } }),
    (e: unknown) => {
      assert.ok(e instanceof ApiClientError);
      assert.equal(e.kind, 'aborted');
      assert.equal(e.outcome, 'not-sent');
      return true;
    },
  );
  assert.equal(calls, 0);
});

test('oversize actual chunks are rejected even when Content-Length lies', async () => {
  let cancelled = false;
  const client = createApiClient(
    async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(new Uint8Array(65));
          },
          cancel() {
            cancelled = true;
          },
        }),
        {
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': '1',
          },
        },
      ),
    { maxResponseBytes: 64 },
  );
  await assert.rejects(client.lab.health(), isCode('RESPONSE_TOO_LARGE'));
  assert.equal(cancelled, true);
});

test(
  'unary endpoints immediately reject and cancel event streams',
  { timeout: 2000 },
  async () => {
    let cancelled = false;
    const client = createApiClient(
      async () =>
        new Response(
          new ReadableStream({
            cancel() {
              cancelled = true;
              return new Promise<void>(() => {});
            },
          }),
          { headers: { 'Content-Type': 'text/event-stream' } },
        ),
    );
    await assert.rejects(
      client.lab.health(),
      isCode('UNEXPECTED_CONTENT_TYPE'),
    );
    assert.equal(cancelled, true);
  },
);

test('invalid UTF-8 is rejected instead of silently replacing payload bytes', async () => {
  const client = createApiClient(
    async () =>
      new Response(new Uint8Array([0xc3, 0x28]), {
        headers: { 'Content-Type': 'application/json' },
      }),
  );
  await assert.rejects(client.lab.health(), isCode('INVALID_UTF8'));
});

test('split UTF-8 characters decode correctly across chunk boundaries', async () => {
  const data = { ...health, framework: 'NestJS 日本' };
  const bytes = new TextEncoder().encode(JSON.stringify(data));
  const client = createApiClient(
    async () =>
      new Response(
        new ReadableStream({
          start(c) {
            for (const byte of bytes) {
              c.enqueue(new Uint8Array([byte]));
            }
            c.close();
          },
        }),
        { headers: { 'Content-Type': 'application/json' } },
      ),
  );
  const response = await client.lab.health();
  assert.equal(response.status, 200);
  if (response.status === 200) {
    assert.equal(response.body.framework, data.framework);
  }
});

test('ambiguous keyed mutation remains unknown after its bounded retries', async () => {
  let calls = 0;
  const client = createApiClient(async () => {
    calls++;
    throw new TypeError('Disconnected after commit');
  });
  await assert.rejects(
    client.lab.validate({
      headers: { 'idempotency-key': 'stable-key' },
      body: { kind: 'chat', payload: {} },
    }),
    (e: unknown) => {
      assert.ok(e instanceof ApiClientError);
      assert.equal(e.kind, 'network');
      assert.equal(e.outcome, 'unknown');
      return true;
    },
  );
  assert.equal(calls, 3);
});

test('error status and retry hint survive oversized diagnostics', async () => {
  const client = createApiClient(
    async () =>
      Response.json(
        { error: { message: 'x'.repeat(500) } },
        {
          status: 429,
          headers: { 'Retry-After': '3', 'X-Request-ID': 'overload-1' },
        },
      ),
    { maxResponseBytes: 64 },
  );
  await assert.rejects(client.lab.health(), (e: unknown) => {
    assert.ok(e instanceof ApiClientError);
    assert.equal(e.kind, 'http');
    assert.equal(e.status, 429);
    assert.equal(e.retryAfterMs, 3000);
    assert.equal(e.requestId, 'overload-1');
    return true;
  });
});

test('Retry-After validates dates, rejects garbage, and clamps hostile delays', () => {
  assert.equal(retryAfterMs('3'), 3000);
  assert.equal(
    retryAfterMs(
      'Wed, 21 Oct 2015 07:28:00 GMT',
      Date.parse('2015-10-21T07:27:59Z'),
    ),
    1000,
  );
  assert.equal(retryAfterMs('-1'), undefined);
  assert.equal(retryAfterMs('1.5'), undefined);
  assert.equal(retryAfterMs('999999999999'), 86_400_000);
});

test('only a pending matching operation can publish success or failure', () => {
  const idle: MutationState<string> = { status: 'idle' };
  const pending: MutationState<string> = { status: 'pending', operation: 2 };
  const stale = { status: 'success' as const, operation: 1, data: 'old' };
  assert.equal(completeMutation(idle, stale), idle);
  assert.equal(completeMutation(pending, stale), pending);
  const success = completeMutation(pending, {
    status: 'success',
    operation: 2,
    data: 'saved',
  });
  assert.equal(success.status, 'success');
  assert.equal(
    completeMutation(success, {
      status: 'error',
      operation: 2,
      error: new Error('health failed'),
    }),
    success,
  );
});

test('OpenAPI exposes the same bounded unary and replay behavior as runtime policy', () => {
  const behavior = httpBehavior(apiContract.lab.validate);
  assert.equal(behavior.maxAttempts, 3);
  assert.equal(behavior.idempotency?.conflictStatus, 409);
  const document = httpOpenApi(browserContract, 'Test', 'test');
  const operation = document.paths[apiContract.lab.validate.path]
    .post as Record<string, unknown>;
  assert.deepEqual(operation['x-runtime-behavior'], behavior);
});
