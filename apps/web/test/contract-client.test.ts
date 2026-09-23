import assert from 'node:assert/strict';
import test from 'node:test';
import {
  apiContract,
  initContract,
  ContractNoBody,
} from '@ai-runtime/contracts/http';
import { createApiClient } from '../src/shared/api/api-client';
import { fetchContract } from '../src/shared/api/http-client';
import { ApiClientError } from '../src/shared/api/http-error';
import { labStatusMetrics } from '../src/features/contract-lab/health-status';

const health = {
  backend: 'ready' as const,
  database: 'PostgreSQL',
  mode: 'contract-only' as const,
  application_id: 'consumer-app',
  saved_checks: 4,
  provider_calls: 0 as const,
  contract_version: 'test',
  framework: 'NestJS + Fastify',
  persistence: 'Prisma',
};

test('inferred client resolves the canonical route, normalizes headers, and preserves idempotency', async () => {
  const client = createApiClient(async (input, init) => {
    assert.equal(input, apiContract.lab.health.path);
    assert.equal(init?.credentials, 'same-origin');
    assert.equal(init?.redirect, 'error');
    assert.equal(new Headers(init?.headers).get('Accept'), 'application/json');
    return Response.json(health);
  });
  const result = await client.lab.health();
  assert.equal(result.status, 200);
  if (result.status === 200) {
    assert.equal(result.body.saved_checks, 4);
  }
  for (const headers of [
    new Headers({ 'Idempotency-Key': 'key-1' }),
    [['Idempotency-Key', 'key-1']],
    { 'Idempotency-Key': 'key-1' },
  ] as const) {
    const normalized = Object.fromEntries(new Headers(headers as HeadersInit));
    await fetchContract(
      {
        route: apiContract.lab.health,
        path: apiContract.lab.health.path,
        method: 'GET',
        headers: normalized,
        body: undefined,
        rawBody: undefined,
        rawQuery: undefined,
        contentType: 'application/json',
      },
      async (_path, init) => {
        assert.equal(
          new Headers(init?.headers).get('idempotency-key'),
          'key-1',
        );
        return Response.json(health);
      },
    );
  }
});

test('204 succeeds only when explicitly declared no-body; arbitrary generics cannot hide it', async () => {
  const route = initContract().query({
    method: 'GET',
    path: '/api/test-empty',
    responses: { 204: ContractNoBody },
  });
  const args = {
    route,
    path: route.path,
    method: 'GET',
    headers: {},
    body: undefined,
    rawBody: undefined,
    rawQuery: undefined,
    contentType: 'application/json' as const,
  };
  const result = await fetchContract(
    args,
    async () => new Response(null, { status: 204 }),
  );
  assert.equal(result.body, undefined);
  await assert.rejects(
    createApiClient(
      async () => new Response(null, { status: 204 }),
    ).lab.health(),
    (cause: unknown) =>
      cause instanceof ApiClientError && cause.code === 'UNDECLARED_STATUS',
  );
});

test('HTTP status and diagnostics survive HTML and malformed error envelopes', async () => {
  await assert.rejects(
    createApiClient(
      async () => new Response('<html>unavailable</html>', { status: 503 }),
    ).lab.health(),
    (error: unknown) =>
      error instanceof ApiClientError &&
      error.kind === 'http' &&
      error.status === 503 &&
      error.code === 'HTTP_503',
  );
  const bad = {
    error: {
      code: 123,
      message: {},
      fields: { name: 456 },
      retryable: 'false',
      execution_id: 'exec-id',
    },
  };
  await assert.rejects(
    createApiClient(async () =>
      Response.json(bad, {
        status: 422,
        headers: { 'X-Request-ID': 'request-1' },
      }),
    ).lab.health(),
    (cause: unknown) => {
      assert.ok(cause instanceof ApiClientError);
      assert.equal(cause.status, 422);
      assert.equal(cause.fields, undefined);
      assert.equal(cause.retryable, undefined);
      assert.equal(cause.requestId, 'request-1');
      assert.equal(cause.executionId, 'exec-id');
      return true;
    },
  );
});

test('network, deadline and body cancellation remain distinct', async () => {
  await assert.rejects(
    createApiClient(async () => {
      throw new TypeError('fetch failed');
    }).lab.health(),
    (e: unknown) =>
      e instanceof ApiClientError && e.kind === 'network' && e.status === null,
  );
  for (const [name, kind] of [
    ['AbortError', 'aborted'],
    ['TimeoutError', 'timeout'],
  ] as const) {
    const controller = new AbortController();
    const client = createApiClient(
      async () =>
        new Response(
          new ReadableStream({
            start(stream) {
              controller.abort(new DOMException('cancelled', name));
              stream.error(controller.signal.reason);
            },
          }),
          { headers: { 'Content-Type': 'application/json' } },
        ),
    );
    await assert.rejects(
      client.lab.health({ fetchOptions: { signal: controller.signal } }),
      (e: unknown) => e instanceof ApiClientError && e.kind === kind,
    );
  }
});

test('successful HTTP with changed response fields fails runtime validation', async () => {
  const { saved_checks: _removed, ...other } = health;
  await assert.rejects(
    createApiClient(async () =>
      Response.json({ ...other, savedChecks: 4 }),
    ).lab.health(),
    (e: unknown) =>
      e instanceof ApiClientError && e.kind === 'invalid-response',
  );
});

test('health failures preserve last-known metrics without claiming outage or recovery', () => {
  const snapshot = { data: health, checkedAt: Date.now() };
  assert.equal(
    labStatusMetrics({ status: 'success', snapshot })[0].value,
    'Healthy',
  );
  const error = new ApiClientError({
    kind: 'http',
    status: 403,
    code: 'DENIED',
    message: 'Denied',
  });
  const metrics = labStatusMetrics({
    status: 'error',
    error,
    previous: snapshot,
  });
  assert.equal(metrics[0].value, 'Access denied');
  assert.equal(metrics[1].value, 'Unknown');
  assert.equal(metrics[2].value, 4);
  assert.equal(metrics[2].badge, 'Last known');
  assert.equal(
    labStatusMetrics({ status: 'error', error: new Error('JSON error') })[0]
      .value,
    'Unconfirmed',
  );
});
