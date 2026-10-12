import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import type { RunnerLeaseCommand } from '@ai-runtime/contracts/http';
import { RunnerLeaseHttpClient } from '../src/runner-lease-http-client.js';

const ack = { state: 'ACTIVE', leaseTtlMs: 15_000, renewIntervalMs: 5_000 };
const response = (value: unknown) => Response.json(value);

function command(): RunnerLeaseCommand {
  return {
    bootId: randomUUID(),
    registrationRevision: 3,
    nonce: 'a'.repeat(32),
    token: {
      assignmentId: randomUUID(),
      executionId: randomUUID(),
      attemptId: randomUUID(),
      runnerId: 'runner-one',
      generation: 2,
      epoch: 4,
    },
  };
}

test('activation and renewal reuse the exact command with bounded machine HTTP', async () => {
  const grant = command();
  const expected = structuredClone(grant);
  const calls: { url: string; init: RequestInit }[] = [];
  let now = 2;
  const client = new RunnerLeaseHttpClient(
    grant,
    {
      origin: 'https://runner-api.example',
      timeoutMs: 1_000,
      bearerToken: async () => 'test-machine-token',
      fetchImpl: async (input, init) => {
        calls.push({ url: String(input), init: init ?? {} });
        return response(ack);
      },
    },
    { nowMs: () => now },
  );
  grant.nonce = 'b'.repeat(32);
  assert.deepEqual(await client.activate(), { startedAtMs: 2, ack });
  now = 5;
  await client.renew();
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(
      call.url,
      'https://runner-api.example/api/runner/v1/leases/activate',
    );
    assert.equal(call.init.method, 'POST');
    assert.equal(call.init.redirect, 'error');
    assert.equal(call.init.cache, 'no-store');
    assert.deepEqual(JSON.parse(String(call.init.body)), expected);
    assert.deepEqual(call.init.headers, {
      authorization: 'Bearer test-machine-token',
      accept: 'application/json',
      'content-type': 'application/json',
      'x-runner-protocol': '1',
    });
    assert.ok(call.init.signal);
  }
});

test('untrusted origins and malformed command are rejected before network use', () => {
  for (const origin of [
    'http://runner-api.example',
    'https://user:pass@runner-api.example',
    'https://runner-api.example/prefix',
    'https://runner-api.example/?x=1',
  ]) {
    assert.throws(
      () =>
        new RunnerLeaseHttpClient(command(), {
          origin,
          timeoutMs: 1_000,
          bearerToken: async () => 'token',
        }),
      /origin/i,
    );
  }
  assert.throws(
    () =>
      new RunnerLeaseHttpClient(
        { ...command(), nonce: 'too-short' },
        {
          origin: 'https://runner-api.example',
          timeoutMs: 1_000,
          bearerToken: async () => 'token',
        },
      ),
  );
});

test('non-200, wrong content type and changed TTL fail closed without retry', async () => {
  const replies = [
    new Response('{}', {
      status: 409,
      headers: { 'content-type': 'application/json' },
    }),
    new Response('{}', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    }),
    response({ ...ack, leaseTtlMs: 30_000 }),
  ];
  let calls = 0;
  const client = new RunnerLeaseHttpClient(command(), {
    origin: 'https://runner-api.example',
    timeoutMs: 1_000,
    bearerToken: async () => 'token',
    fetchImpl: async () => {
      calls++;
      return replies.shift()!;
    },
  });
  for (let n = 1; n <= 3; n++) {
    await assert.rejects(
      client.activate(),
      /^Error: Runner lease activation failed\.$/,
    );
    assert.equal(calls, n);
  }
});

test('declared and streamed oversized responses are rejected', async () => {
  const oversized = new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(65_537));
        controller.close();
      },
    }),
    { headers: { 'content-type': 'application/json' } },
  );
  const declared = new Response('{}', {
    headers: {
      'content-type': 'application/json',
      'content-length': '65537',
    },
  });
  const replies = [declared, oversized];
  const client = new RunnerLeaseHttpClient(command(), {
    origin: 'https://runner-api.example',
    timeoutMs: 1_000,
    bearerToken: async () => 'token',
    fetchImpl: async () => replies.shift()!,
  });
  await assert.rejects(client.activate(), /activation failed/);
  await assert.rejects(client.activate(), /activation failed/);
});

test('deadline during credential acquisition prevents a late HTTP request', async () => {
  let finishToken!: (token: string) => void;
  const pendingToken = new Promise<string>((resolve) => {
    finishToken = resolve;
  });
  let calls = 0;
  const client = new RunnerLeaseHttpClient(command(), {
    origin: 'http://127.0.0.1:54321',
    allowHttpLoopbackForTests: true,
    timeoutMs: 100,
    bearerToken: () => pendingToken,
    fetchImpl: async () => {
      calls++;
      return response(ack);
    },
  });
  await assert.rejects(client.activate(), /activation failed/);
  finishToken('late-token');
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(calls, 0);
});

test('deadline also bounds a stalled response body', async () => {
  let signal: AbortSignal | undefined;
  const client = new RunnerLeaseHttpClient(command(), {
    origin: 'https://runner-api.example',
    timeoutMs: 100,
    bearerToken: async () => 'token',
    fetchImpl: async (_input, init) => {
      signal = init?.signal ?? undefined;
      return new Response(new ReadableStream<Uint8Array>(), {
        headers: { 'content-type': 'application/json' },
      });
    },
  });
  await assert.rejects(client.activate(), /activation failed/);
  assert.equal(signal?.aborted, true);
});

test('invalid credential is never sent and error details are sanitized', async () => {
  let calls = 0;
  const client = new RunnerLeaseHttpClient(command(), {
    origin: 'https://runner-api.example',
    timeoutMs: 1_000,
    bearerToken: async () => 'secret\nheader',
    fetchImpl: async () => {
      calls++;
      return response(ack);
    },
  });
  await assert.rejects(
    client.activate(),
    /^Error: Runner lease activation failed\.$/,
  );
  assert.equal(calls, 0);
});
