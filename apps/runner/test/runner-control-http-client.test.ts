import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import type {
  RunnerHeartbeat,
  RunnerLeaseCommand,
} from '@ai-runtime/contracts/http';
import { RunnerControlHttpClient } from '../src/runner-control-http-client.js';
import {
  RunnerHttpError,
  type RunnerHttpOptions,
} from '../src/runner-http-transport.js';

function identity(): RunnerHeartbeat {
  return {
    runnerId: 'worker-one',
    bootId: randomUUID(),
    registrationRevision: 3,
  };
}
function options(fetchImpl: typeof fetch): RunnerHttpOptions {
  return {
    origin: 'https://runner-api.example',
    bearerToken: async () => 'fixture-token',
    timeoutMs: 100,
    fetchImpl,
  };
}
const kind = (expected: RunnerHttpError['kind']) => (error: unknown) =>
  error instanceof RunnerHttpError && error.kind === expected;

test('heartbeat captures one boot and rejects acknowledgements for a different identity', async () => {
  const process = identity();
  const captured = structuredClone(process);
  let calls = 0;
  const client = new RunnerControlHttpClient(
    process,
    'owner-one',
    options(async (_input, init) => {
      assert.deepEqual(JSON.parse(String(init?.body)), captured);
      assert.equal(init?.redirect, 'error');
      return Response.json({
        ...captured,
        bootId: ++calls === 1 ? captured.bootId : randomUUID(),
        state: 'ALIVE',
        heartbeatIntervalMs: 5_000,
        presenceTtlMs: 15_000,
      });
    }),
  );
  process.bootId = randomUUID();
  await client.heartbeat();
  await assert.rejects(client.heartbeat(), kind('INVALID'));
  assert.equal(calls, 2);
});

test('claim rejects a malformed grant without exposing upstream details', async () => {
  const process = identity();
  const client = new RunnerControlHttpClient(
    process,
    'owner-one',
    options(async () =>
      Response.json({ grant: { ownerSubject: 'private-upstream-data' } }),
    ),
  );
  await assert.rejects(
    client.claim(),
    (error: unknown) =>
      kind('INVALID')(error) &&
      !String(error).includes('private-upstream-data'),
  );
});

test('STARTED report requires exact command and acknowledgement authority', async () => {
  const process = identity();
  const command: RunnerLeaseCommand = {
    bootId: process.bootId,
    registrationRevision: process.registrationRevision,
    nonce: 'a'.repeat(32),
    token: {
      assignmentId: randomUUID(),
      executionId: randomUUID(),
      attemptId: randomUUID(),
      runnerId: process.runnerId,
      generation: 1,
      epoch: 2,
    },
  };
  let calls = 0;
  const client = new RunnerControlHttpClient(
    process,
    'owner-one',
    options(async (_input, init) => {
      calls++;
      assert.deepEqual(JSON.parse(String(init?.body)), {
        type: 'started',
        token: command.token,
        lease: {
          bootId: command.bootId,
          registrationRevision: 3,
          nonce: command.nonce,
        },
      });
      return Response.json({
        ...command.token,
        generation: 99,
        ownerSubject: 'owner-one',
        state: 'STARTED',
        protocolVersion: '1',
      });
    }),
  );
  await assert.rejects(
    client.reportStarted({ ...command, bootId: randomUUID() }),
    kind('INVALID'),
  );
  assert.equal(calls, 0);
  await assert.rejects(client.reportStarted(command), kind('INVALID'));
  assert.equal(calls, 1);
});

test('caller abort bounds pending credentials and prevents a late HTTP request', async () => {
  let supply!: (value: string) => void;
  let calls = 0;
  const http = options(async () => {
    calls++;
    return Response.json({ grant: null });
  });
  http.bearerToken = () =>
    new Promise((resolve) => {
      supply = resolve;
    });
  const client = new RunnerControlHttpClient(identity(), 'owner-one', http);
  const controller = new AbortController();
  const request = client.claim(controller.signal);
  const rejected = assert.rejects(request, kind('UNAVAILABLE'));
  await new Promise<void>((resolve) => setImmediate(resolve));
  controller.abort();
  await rejected;
  supply('fixture-late-token');
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(calls, 0);
  await assert.rejects(client.claim(controller.signal), kind('UNAVAILABLE'));
  assert.equal(calls, 0);
});

test('oversize, invalid UTF-8 and non-JSON claim bodies fail closed', async () => {
  const responses = [
    new Response(new Uint8Array(65_537), {
      headers: { 'content-type': 'application/json' },
    }),
    new Response(new Uint8Array([0xff]), {
      headers: { 'content-type': 'application/json' },
    }),
    new Response('{}', { headers: { 'content-type': 'text/html' } }),
  ];
  const client = new RunnerControlHttpClient(
    identity(),
    'owner-one',
    options(async () => responses.shift()!),
  );
  for (let count = 0; count < 3; count++) {
    await assert.rejects(client.claim(), kind('INVALID'));
  }
});

test('transport distinguishes transient claim outcomes from rejected credentials without retries', async () => {
  let calls = 0;
  const statuses = [503, 429, 403];
  const client = new RunnerControlHttpClient(
    identity(),
    'owner-one',
    options(async () => {
      calls++;
      return new Response('private-upstream-diagnostic', {
        status: statuses.shift()!,
      });
    }),
  );
  for (const expected of ['UNAVAILABLE', 'UNAVAILABLE', 'REJECTED'] as const) {
    await assert.rejects(
      client.claim(),
      (error) =>
        kind(expected)(error) && !String(error).includes('private-upstream'),
    );
  }
  assert.equal(calls, 3);
});
