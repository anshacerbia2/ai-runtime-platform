import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import type {
  RunnerDispatchGrant,
  RunnerLeaseCommand,
} from '@ai-runtime/contracts/http';
import { RunnerDispatchHttpClient } from '../src/runner-dispatch-http-client.js';
import {
  RunnerHttpError,
  type RunnerHttpOptions,
} from '../src/runner-http-transport.js';

function fixture() {
  const payload = Buffer.from('private payload');
  const content = Buffer.from('fixture instructions');
  const plugin = Buffer.from(
    JSON.stringify({
      format: 'ai-runtime-plugin/v1',
      packageId: 'draft',
      version: '1',
      compatibleRuntimeVersions: ['claude:1'],
      requiredPermissions: ['artifact:write'],
      files: [
        {
          path: 'instructions.md',
          sha256: createHash('sha256').update(content).digest('hex'),
          contentBase64: content.toString('base64'),
        },
      ],
    }),
  );
  const command: RunnerLeaseCommand = {
    bootId: randomUUID(),
    registrationRevision: 2,
    nonce: 'n'.repeat(32),
    token: {
      assignmentId: randomUUID(),
      executionId: randomUUID(),
      attemptId: randomUUID(),
      runnerId: 'runner-one',
      generation: 1,
      epoch: 2,
    },
  };
  const grant: RunnerDispatchGrant = {
    ...command.token,
    ownerSubject: 'owner-one',
    protocolVersion: '1',
    state: 'GRANTED',
    envelopeId: randomUUID(),
    inputDigest: 'a'.repeat(64),
    plaintextBytes: payload.length,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    plugin: {
      packageId: 'draft',
      version: '1',
      bundleDigest: createHash('sha256').update(plugin).digest('hex'),
      runtimeVersion: 'claude:1',
      requiredPermissions: ['artifact:write'],
    },
  };
  return { payload, plugin, command, grant };
}
const options = (fetchImpl: typeof fetch): RunnerHttpOptions => ({
  origin: 'https://runner-api.example',
  timeoutMs: 100,
  bearerToken: async () => 'fixture-token',
  fetchImpl,
});
function binary(bytes: Uint8Array, headers: Record<string, string> = {}) {
  return new Response(new Uint8Array(bytes), {
    headers: {
      'content-type': 'application/octet-stream',
      'content-length': String(bytes.length),
      'cache-control': 'no-store',
      ...headers,
    },
  });
}
const invalid = (error: unknown) =>
  error instanceof RunnerHttpError && error.kind === 'INVALID';

test('payload and plugin handoff capture one exact lease/envelope and verify pinned bytes', async () => {
  const f = fixture();
  const expected = {
    ...structuredClone(f.command),
    envelopeId: f.grant.envelopeId,
  };
  const paths: string[] = [];
  const client = new RunnerDispatchHttpClient(
    f.command,
    f.grant,
    options(async (input, init) => {
      const path = new URL(String(input)).pathname;
      paths.push(path);
      assert.deepEqual(JSON.parse(String(init?.body)), expected);
      assert.equal(init?.redirect, 'error');
      assert.equal(init?.cache, 'no-store');
      assert.equal(
        new Headers(init?.headers).get('authorization'),
        'Bearer fixture-token',
      );
      assert.equal(
        new Headers(init?.headers).get('accept'),
        'application/octet-stream',
      );
      return binary(path.endsWith('/payload') ? f.payload : f.plugin);
    }),
  );
  f.command.nonce = 'z'.repeat(32);
  f.grant.envelopeId = randomUUID();
  assert.deepEqual(await client.payload(), new Uint8Array(f.payload));
  assert.deepEqual(await client.plugin(), new Uint8Array(f.plugin));
  assert.deepEqual(paths, [
    '/api/runner/v1/dispatches/payload',
    '/api/runner/v1/dispatches/plugin',
  ]);
});

test('mismatched grant scope is rejected before HTTP and absent plugin does not download', async () => {
  const f = fixture();
  let calls = 0;
  const http = options(async () => {
    calls++;
    return binary(f.payload);
  });
  for (const field of [
    'assignmentId',
    'executionId',
    'attemptId',
    'runnerId',
    'generation',
    'epoch',
  ] as const) {
    const grant = {
      ...f.grant,
      [field]: typeof f.grant[field] === 'number' ? 3 : randomUUID(),
    };
    assert.throws(
      () => new RunnerDispatchHttpClient(f.command, grant, http),
      invalid,
    );
  }
  const client = new RunnerDispatchHttpClient(
    f.command,
    { ...f.grant, plugin: null },
    http,
  );
  assert.equal(await client.plugin(), null);
  assert.equal(calls, 0);
});

test('payload size and plugin digest/runtime/permission mismatches fail closed with sanitized errors', async () => {
  const f = fixture();
  const cases = [
    {
      grant: { ...f.grant, plaintextBytes: f.payload.length + 1 },
      bytes: f.payload,
      method: 'payload' as const,
    },
    {
      grant: f.grant,
      bytes: Buffer.from('private-upstream-data'),
      method: 'plugin' as const,
    },
    {
      grant: {
        ...f.grant,
        plugin: { ...f.grant.plugin!, runtimeVersion: 'other:1' },
      },
      bytes: f.plugin,
      method: 'plugin' as const,
    },
    {
      grant: {
        ...f.grant,
        plugin: { ...f.grant.plugin!, requiredPermissions: [] },
      },
      bytes: f.plugin,
      method: 'plugin' as const,
    },
  ];
  for (const c of cases) {
    const client = new RunnerDispatchHttpClient(
      f.command,
      c.grant,
      options(async () => binary(c.bytes)),
    );
    await assert.rejects(
      client[c.method](),
      (error: unknown) =>
        invalid(error) && !String(error).includes('private-upstream-data'),
    );
  }
});

test('binary handoff rejects invalid content metadata, truncation, oversize, and redirects', async () => {
  const f = fixture();
  const responses = [
    () => binary(f.payload, { 'content-type': 'application/json' }),
    () => binary(f.payload, { 'content-length': '-1' }),
    () => binary(f.payload, { 'content-length': '1048577' }),
    () => binary(f.payload, { 'content-length': String(f.payload.length + 1) }),
    () => binary(f.payload, { 'content-length': '1' }),
    () => binary(f.payload, { 'content-encoding': 'gzip' }),
    () => binary(f.payload, { 'cache-control': 'public, max-age=60' }),
    () =>
      new Response(f.payload, {
        headers: {
          'content-type': 'application/octet-stream',
          'cache-control': 'no-store',
        },
      }),
    () => {
      const response = binary(f.payload);
      Object.defineProperty(response, 'redirected', { value: true });
      return response;
    },
    () =>
      new Response(null, {
        status: 302,
        headers: { location: 'https://untrusted.example' },
      }),
  ];
  for (const response of responses) {
    let calls = 0;
    const client = new RunnerDispatchHttpClient(
      f.command,
      f.grant,
      options(async () => {
        calls++;
        return response();
      }),
    );
    await assert.rejects(client.payload(), RunnerHttpError);
    assert.equal(calls, 1);
  }
});

test('binary handoff bounds chunk bytes even when declared size is small and erases partial bytes', async () => {
  const f = fixture();
  const chunk = new Uint8Array(1_048_577).fill(7);
  let cancelled = false;
  const client = new RunnerDispatchHttpClient(
    f.command,
    f.grant,
    options(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(chunk);
            },
            cancel() {
              cancelled = true;
            },
          }),
          {
            headers: {
              'content-type': 'application/octet-stream',
              'content-length': '1',
              'cache-control': 'no-store',
            },
          },
        ),
    ),
  );
  await assert.rejects(client.payload(), invalid);
  assert.equal(cancelled, true);
  assert.ok(chunk.every((x) => x === 0));
});

test('binary handoff joins small chunks correctly and erases stream-owned copies', async () => {
  const f = fixture();
  const chunks = [
    new Uint8Array(f.payload.subarray(0, 3)),
    new Uint8Array(f.payload.subarray(3)),
  ];
  const client = new RunnerDispatchHttpClient(
    f.command,
    f.grant,
    options(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              for (const chunk of chunks) {
                controller.enqueue(chunk);
              }
              controller.close();
            },
          }),
          {
            headers: {
              'content-type': 'application/octet-stream',
              'content-length': String(f.payload.length),
              'cache-control': 'no-store',
            },
          },
        ),
    ),
  );
  assert.deepEqual(await client.payload(), new Uint8Array(f.payload));
  for (const chunk of chunks) {
    assert.ok(chunk.every((x) => x === 0));
  }
});

test('credential wait is bounded and late credential acquisition cannot dispatch', async () => {
  const f = fixture();
  let release!: (value: string) => void;
  let calls = 0;
  const http = options(async () => {
    calls++;
    return binary(f.payload);
  });
  http.bearerToken = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  const client = new RunnerDispatchHttpClient(f.command, f.grant, http);
  await assert.rejects(client.payload(), RunnerHttpError);
  release('fixture-token');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 0);
});

test('stalled binary body times out, cancels reading, and erases received chunks without retry', async () => {
  const f = fixture();
  const chunk = new Uint8Array([11, 12]);
  let cancelled = false;
  let calls = 0;
  const client = new RunnerDispatchHttpClient(
    f.command,
    f.grant,
    options(async () => {
      calls++;
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(chunk);
          },
          cancel() {
            cancelled = true;
          },
        }),
        {
          headers: {
            'content-type': 'application/octet-stream',
            'content-length': String(f.payload.length),
            'cache-control': 'no-store',
          },
        },
      );
    }),
  );
  await assert.rejects(client.payload(), RunnerHttpError);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  assert.equal(cancelled, true);
  assert.deepEqual([...chunk], [0, 0]);
});

test('caller abort denies download and late fetch response cannot return private bytes', async () => {
  const f = fixture();
  const abort = new AbortController();
  let release!: (value: Response) => void;
  let cancelled = false;
  const client = new RunnerDispatchHttpClient(
    f.command,
    f.grant,
    options(
      async () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    ),
  );
  const pending = client.payload(abort.signal);
  await new Promise((resolve) => setImmediate(resolve));
  abort.abort();
  await assert.rejects(pending, RunnerHttpError);
  release(
    new Response(
      new ReadableStream({
        cancel() {
          cancelled = true;
        },
      }),
      {
        headers: {
          'content-type': 'application/octet-stream',
          'content-length': '1',
          'cache-control': 'no-store',
        },
      },
    ),
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(cancelled, true);
  await assert.rejects(client.payload(abort.signal), RunnerHttpError);
});
