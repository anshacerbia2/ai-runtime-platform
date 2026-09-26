import test from 'node:test';
import assert from 'node:assert/strict';
import { apiContract, httpBehavior } from '@ai-runtime/contracts/http';
import { createApiClient } from '../src/shared/api/api-client';
import { fetchContract } from '../src/shared/api/http-client';
import { ApiClientError } from '../src/shared/api/http-error';
import { RetryBudget } from '../src/shared/api/retry-policy';
const body = {
  expectedRevision: 1,
  displayName: 'Fixture',
  environment: 'local',
  provider: 'fixture',
  authMode: 'API_KEY' as const,
  sharingMode: 'DEDICATED' as const,
  quotaGroupRef: null,
  status: 'ENABLED' as const,
};
const receipt = {
  resource: {
    id: 'connection-1',
    displayName: 'Fixture',
    environment: 'local',
    provider: 'fixture',
    authMode: 'API_KEY',
    sharingMode: 'DEDICATED',
    quotaGroupRef: null,
    gatewayMaxConcurrency: 100,
    gatewayRequestsPerMinute: 600,
    status: 'ENABLED',
    revision: 2,
  },
  receipt: {
    id: '10000000-0000-4000-8000-000000000001',
    key: 'request-1',
    replayed: true,
    completedAt: '2026-09-24T00:00:00.000Z',
  },
};

test('receipt-backed retry preserves serialized command and key after lost acknowledgement', async () => {
  const calls: {
    path: string;
    body: BodyInit | null | undefined;
    key: string | null;
  }[] = [];
  const client = createApiClient(async (path, init) => {
    calls.push({
      path: String(path),
      body: init?.body,
      key: new Headers(init?.headers).get('idempotency-key'),
    });
    if (calls.length === 1) {
      throw new TypeError('Acknowledgement lost after commit');
    }
    return Response.json(receipt);
  });
  const result = await client.resources.connections.replace({
    params: { id: 'connection-1' },
    headers: { 'idempotency-key': 'request-1' },
    body,
  });
  assert.equal(result.status, 200);
  assert.deepEqual(calls[0], calls[1]);
  assert.equal(calls.length, 2);
  if (result.status === 200) {
    assert.equal(result.body.receipt.replayed, true);
    assert.equal(result.body.resource.revision, 2);
  }
});

test('arbitrary idempotency headers do not make legacy management automatically replayable', async () => {
  const route = apiContract.controlPlane.manage;
  let calls = 0;
  await assert.rejects(
    fetchContract(
      {
        route,
        path: route.path,
        method: 'PUT',
        headers: { 'idempotency-key': 'not-supported' },
        body: '{}',
        rawBody: {},
        rawQuery: {},
        contentType: 'application/json',
      },
      async () => {
        calls++;
        throw new TypeError('Disconnected');
      },
    ),
    ApiClientError,
  );
  assert.equal(calls, 1);
  assert.equal(httpBehavior(route).replay, 'none');
});

test('application conflicts, forbidden responses, and response contract violations are never retried', async () => {
  for (const status of [400, 401, 403, 409, 410, 422]) {
    let calls = 0;
    const client = createApiClient(async () => {
      calls++;
      return Response.json(
        { error: { code: 'REJECTED', message: 'Rejected' } },
        { status },
      );
    });
    await assert.rejects(
      client.resources.connections.replace({
        params: { id: 'connection-1' },
        headers: { 'idempotency-key': 'request-1' },
        body,
      }),
      ApiClientError,
    );
    assert.equal(calls, 1);
  }
  let calls = 0;
  const invalid = createApiClient(async () => {
    calls++;
    return Response.json({ notAReceipt: true });
  });
  await assert.rejects(
    invalid.resources.connections.replace({
      params: { id: 'connection-1' },
      headers: { 'idempotency-key': 'request-1' },
      body,
    }),
    (e: unknown) =>
      e instanceof ApiClientError && e.kind === 'invalid-response',
  );
  assert.equal(calls, 1);
});

test('Retry-After beyond remaining deadline suppresses retry instead of resetting the budget', async () => {
  let calls = 0;
  const client = createApiClient(
    async () => {
      calls++;
      return Response.json(
        { error: { code: 'UNAVAILABLE', message: 'Busy' } },
        { status: 503, headers: { 'Retry-After': '20' } },
      );
    },
    { timeoutMs: 100 },
  );
  await assert.rejects(
    client.resources.connections.replace({
      params: { id: 'connection-1' },
      headers: { 'idempotency-key': 'request-1' },
      body,
    }),
    ApiClientError,
  );
  assert.equal(calls, 1);
});

test('caller abort during retry backoff sends no second request and preserves unknown outcome', async () => {
  const controller = new AbortController();
  let calls = 0;
  const client = createApiClient(async () => {
    calls++;
    setTimeout(() => controller.abort(), 15);
    return Response.json(
      { error: { code: 'UNAVAILABLE', message: 'Busy' } },
      { status: 503, headers: { 'Retry-After': '1' } },
    );
  });
  await assert.rejects(
    client.resources.connections.replace({
      params: { id: 'connection-1' },
      headers: { 'idempotency-key': 'request-1' },
      body,
      fetchOptions: { signal: controller.signal },
    }),
    (e: unknown) =>
      e instanceof ApiClientError &&
      e.kind === 'aborted' &&
      e.outcome === 'unknown',
  );
  assert.equal(calls, 1);
});

test('retry budget exhaustion prevents retry amplification', async () => {
  let calls = 0;
  const route = apiContract.resources.connections.replace;
  await assert.rejects(
    fetchContract(
      {
        route,
        path: '/api/v1/connections/connection-1',
        method: 'PUT',
        headers: { 'idempotency-key': 'request-1' },
        body: JSON.stringify(body),
        rawBody: body,
        rawQuery: {},
        contentType: 'application/json',
      },
      async () => {
        calls++;
        throw new TypeError('No network');
      },
      {},
      new RetryBudget(0, 0),
    ),
    ApiClientError,
  );
  assert.equal(calls, 1);
});
