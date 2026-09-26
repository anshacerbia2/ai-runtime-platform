import test from 'node:test';
import assert from 'node:assert/strict';
import { forward } from '../src/server/api-gateway/forward';
import { fixtureConfig, fixtureSessions, user } from './fixtures';
import type { WebRuntime } from '../src/server/runtime';

async function fixture() {
  const config = fixtureConfig();
  const { manager } = fixtureSessions();
  const reference = await manager.create(
    { accessToken: 'server-access', expiresAt: Date.now() + 10000 },
    user,
  );
  return {
    runtime: { config, sessions: manager } as WebRuntime,
    cookie: config.hosting!.cookieName + '=' + reference,
  };
}

test('G39 unauthenticated BFF request fails before the API is contacted', async () => {
  let calls = 0;
  const { runtime } = await fixture();
  const response = await forward(
    new Request('https://console.invalid/api/m1/control-plane', {
      headers: {
        Authorization: 'Bearer attacker',
        'X-ATI-One-Proxy': 'attacker',
      },
    }),
    ['m1', 'control-plane'],
    runtime,
    async () => {
      calls++;
      return Response.json({});
    },
  );
  assert.equal(response.status, 401);
  assert.equal(calls, 0);
});

test('G37 BFF forwards only the server token, preserves API status, and never forwards cookies or proxy headers', async () => {
  const { runtime, cookie } = await fixture();
  const request = new Request('https://console.invalid/api/m1/control-plane', {
    method: 'PUT',
    body: '{}',
    headers: {
      Cookie: cookie,
      Authorization: 'Bearer attacker',
      'X-ATI-One-Proxy': 'attacker',
      'Content-Type': 'application/json',
      Origin: 'https://console.invalid',
      'Idempotency-Key': 'same-key',
    },
  });
  const response = await forward(
    request,
    ['m1', 'control-plane'],
    runtime,
    async (input, init) => {
      assert.equal(String(input), 'https://api.invalid/api/m1/control-plane');
      const h = new Headers(init?.headers);
      assert.equal(h.get('Authorization'), 'Bearer server-access');
      assert.equal(h.get('Cookie'), null);
      assert.equal(h.get('X-ATI-One-Proxy'), null);
      assert.equal(h.get('Idempotency-Key'), 'same-key');
      assert.equal(init?.redirect, 'error');
      return Response.json(
        { error: { code: 'CONFLICT', message: 'Conflict' } },
        {
          status: 409,
          headers: { 'Set-Cookie': 'untrusted=1', 'X-Request-ID': 'req-1' },
        },
      );
    },
  );
  assert.equal(response.status, 409);
  assert.equal(response.headers.get('Set-Cookie'), null);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(response.headers.get('X-Request-ID'), 'req-1');
  assert.equal((await response.text()).includes('server-access'), false);
});

test('G37 origin, fetch-site and host checks reject CSRF and rebinding', async () => {
  const { runtime, cookie } = await fixture();
  for (const extra of [
    { Origin: 'https://attacker.invalid' },
    { Host: 'attacker.invalid' },
    { 'Sec-Fetch-Site': 'cross-site' },
  ]) {
    let calls = 0;
    const headers = new Headers({
      Cookie: cookie,
      Origin: 'https://console.invalid',
      'Content-Type': 'application/json',
    });
    for (const [key, value] of Object.entries(extra)) {
      headers.set(key, value);
    }
    const response = await forward(
      new Request('https://console.invalid/api/m1/control-plane', {
        method: 'PUT',
        headers,
        body: '{}',
      }),
      ['m1', 'control-plane'],
      runtime,
      async () => {
        calls++;
        return Response.json({});
      },
    );
    assert.equal(response.status, 403);
    assert.equal(calls, 0);
  }
});

test('G39 forwarder rejects traversal, arbitrary URLs, machine-only endpoints, and unlisted methods', async () => {
  const { runtime, cookie } = await fixture();
  for (const segments of [
    ['..', '.env'],
    ['m1', '..', 'auth'],
    ['https:', 'attacker'],
    ['m1', 'runners', 'register'],
    ['m1', 'control-plane%2f..'],
  ]) {
    const response = await forward(
      new Request('https://console.invalid/api/test', {
        headers: { Cookie: cookie },
      }),
      segments,
      runtime,
      async () => {
        throw Error('must not call');
      },
    );
    assert.equal(response.status, 404);
  }
  const response = await forward(
    new Request('https://console.invalid/api/m1/control-plane', {
      method: 'DELETE',
      headers: { Cookie: cookie, Origin: 'https://console.invalid' },
    }),
    ['m1', 'control-plane'],
    runtime,
  );
  assert.equal(response.status, 405);
});

test('BFF enforces real request-byte limits and masks upstream error details', async () => {
  const { runtime, cookie } = await fixture();
  const request = new Request('https://console.invalid/api/m1/control-plane', {
    method: 'PUT',
    headers: {
      Cookie: cookie,
      Origin: 'https://console.invalid',
      'Content-Type': 'application/json',
    },
    body: 'x'.repeat(1025),
  });
  assert.equal(
    (
      await forward(request, ['m1', 'control-plane'], runtime, async () => {
        throw Error('must not call');
      })
    ).status,
    413,
  );
  const result = await forward(
    new Request('https://console.invalid/api/m1/control-plane', {
      headers: { Cookie: cookie },
    }),
    ['m1', 'control-plane'],
    runtime,
    async () => {
      throw Error('sensitive-client-secret');
    },
  );
  assert.equal(result.status, 503);
  assert.equal(
    (await result.text()).includes('sensitive-client-secret'),
    false,
  );
});

test('M0 local credentials are scoped by route and can never be used in OIDC mode', async () => {
  const config = fixtureConfig();
  const runtime: WebRuntime = {
    config: {
      ...config,
      local: true,
      runtimeMode: 'm0-local',
      hosting: undefined,
      auth: undefined,
      applicationToken: 'local-app',
      operatorToken: 'local-operator',
    },
  };
  for (const [route, expected] of [
    ['m0/health', 'local-app'],
    ['m1/control-plane', 'local-operator'],
  ]) {
    const result = await forward(
      new Request('https://console.invalid/api/' + route),
      route.split('/'),
      runtime,
      async (_url, init) => {
        assert.equal(
          new Headers(init?.headers).get('Authorization'),
          'Bearer ' + expected,
        );
        return Response.json(
          route === 'm0/health'
            ? {
                backend: 'ready',
                database: 'PostgreSQL',
                mode: 'contract-only',
                application_id: 'unit',
                saved_checks: 0,
                provider_calls: 0,
                contract_version: 'test',
                framework: 'NestJS + Fastify',
                persistence: 'Prisma',
              }
            : {
                applications: [],
                connections: [],
                credentials: [],
                bindings: [],
                aliases: [],
                profiles: [],
                budgets: [],
                pools: [],
                runners: [],
              },
        );
      },
    );
    assert.equal(result.status, 200);
  }
  const response = await forward(
    new Request('https://console.invalid/api/m0/health'),
    ['m0', 'health'],
    { config },
    async () => {
      throw Error('must not call');
    },
  );
  assert.equal(response.status, 404);
});

test('BFF hides upstream server failures and rejects JSON lookalike media types', async () => {
  const { runtime, cookie } = await fixture();
  const response = await forward(
    new Request('https://console.invalid/api/m1/control-plane', {
      headers: { Cookie: cookie },
    }),
    ['m1', 'control-plane'],
    runtime,
    async () =>
      Response.json(
        { error: { message: 'secret-sql-connection-string' } },
        { status: 500 },
      ),
  );
  assert.equal(response.status, 502);
  assert.doesNotMatch(await response.text(), /secret-sql/);
  const unsupported = await forward(
    new Request('https://console.invalid/api/m1/control-plane', {
      method: 'PUT',
      body: '{}',
      headers: {
        Cookie: cookie,
        Origin: 'https://console.invalid',
        'Content-Type': 'application/jsonp',
      },
    }),
    ['m1', 'control-plane'],
    runtime,
    async () => {
      throw new Error('Must not call upstream.');
    },
  );
  assert.equal(unsupported.status, 415);
});

test('BFF rejects upstream JSON lookalikes and cancels their response bodies', async () => {
  const { runtime, cookie } = await fixture();
  for (const mediaType of ['application/jsonp', 'text/application/json']) {
    let cancelled = false;
    const response = await forward(
      new Request('https://console.invalid/api/m1/control-plane', {
        headers: { Cookie: cookie },
      }),
      ['m1', 'control-plane'],
      runtime,
      async () =>
        new Response(
          new ReadableStream({
            cancel() {
              cancelled = true;
            },
          }),
          { headers: { 'Content-Type': mediaType } },
        ),
    );
    assert.equal(response.status, 502);
    assert.equal(cancelled, true);
    assert.equal(
      (await response.json()).error.code,
      'INVALID_UPSTREAM_RESPONSE',
    );
  }
});

test('BFF response size violation is upstream 502 rather than a false request 413', async () => {
  const { runtime, cookie } = await fixture();
  const response = await forward(
    new Request('https://console.invalid/api/m1/control-plane', {
      headers: { Cookie: cookie },
    }),
    ['m1', 'control-plane'],
    runtime,
    async () => Response.json({ data: 'x'.repeat(5000) }),
  );
  assert.equal(response.status, 502);
  assert.equal(
    (await response.json()).error.code,
    'UPSTREAM_RESPONSE_TOO_LARGE',
  );
});

test('BFF preserves safe overload hints and correlation while masking upstream secrets', async () => {
  const { runtime, cookie } = await fixture();
  const response = await forward(
    new Request('https://console.invalid/api/m1/control-plane', {
      headers: { Cookie: cookie },
    }),
    ['m1', 'control-plane'],
    runtime,
    async () =>
      Response.json(
        { error: { message: 'secret-upstream-details' } },
        {
          status: 503,
          headers: {
            'Retry-After': '5',
            'X-Request-ID': 'load-1',
            'Set-Cookie': 'private=1',
          },
        },
      ),
  );
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('retry-after'), '5');
  assert.equal(response.headers.get('x-request-id'), 'load-1');
  assert.equal(response.headers.get('set-cookie'), null);
  assert.doesNotMatch(await response.text(), /secret-upstream/);
});

test(
  'BFF deadline stops a non-cooperative upstream and distinguishes gateway timeout',
  { timeout: 2000 },
  async () => {
    const { runtime, cookie } = await fixture();
    let calls = 0;
    const response = await forward(
      new Request('https://console.invalid/api/m1/control-plane', {
        headers: { Cookie: cookie },
      }),
      ['m1', 'control-plane'],
      { ...runtime, config: { ...runtime.config, requestTimeoutMs: 30 } },
      () => {
        calls++;
        return new Promise<Response>(() => {});
      },
    );
    assert.equal(response.status, 504);
    assert.equal((await response.json()).error.code, 'REQUEST_TIMEOUT');
    assert.equal(calls, 1);
  },
);

test(
  'BFF deadline includes session access and prevents dispatch after expiry',
  { timeout: 2000 },
  async () => {
    const { runtime, cookie } = await fixture();
    runtime.sessions!.access = () => new Promise<string>(() => {});
    let calls = 0;
    const response = await forward(
      new Request('https://console.invalid/api/m1/control-plane', {
        headers: { Cookie: cookie },
      }),
      ['m1', 'control-plane'],
      { ...runtime, config: { ...runtime.config, requestTimeoutMs: 30 } },
      async () => {
        calls++;
        return Response.json({});
      },
    );
    assert.equal(response.status, 408);
    assert.equal(calls, 0);
  },
);

test('BFF accepts colon resource identifiers declared by the shared contract without allowing traversal', async () => {
  const { runtime, cookie } = await fixture();
  let calls = 0;
  const response = await forward(
    new Request('https://console.invalid/api/v1/connections/team%3Aone', {
      method: 'PUT',
      body: '{}',
      headers: {
        Cookie: cookie,
        Origin: 'https://console.invalid',
        'Content-Type': 'application/json',
        'Idempotency-Key': 'colon-key',
      },
    }),
    ['v1', 'connections', 'team:one'],
    runtime,
    async (url) => {
      calls++;
      assert.equal(
        new URL(String(url)).pathname,
        '/api/v1/connections/team:one',
      );
      return Response.json({
        resource: {
          id: 'team:one',
          displayName: 'Fixture',
          provider: 'fixture',
          authMode: 'API_KEY',
          environment: 'local',
          sharingMode: 'DEDICATED',
          quotaGroupRef: null,
          gatewayMaxConcurrency: 100,
          gatewayRequestsPerMinute: 600,
          status: 'ENABLED',
          revision: 1,
        },
        receipt: {
          id: '30000000-0000-4000-8000-000000000003',
          key: 'colon-key',
          replayed: false,
          completedAt: '2026-09-24T00:00:00.000Z',
        },
      });
    },
  );
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal(calls, 1);
  assert.equal((await response.json()).resource.id, 'team:one');
});
test('BFF passes gateway SSE through incrementally without whole-response buffering', async () => {
  const { runtime, cookie } = await fixture();
  const encoder = new TextEncoder();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const upstream = new ReadableStream<Uint8Array>({
    start(value) {
      controller = value;
      value.enqueue(
        encoder.encode(
          'id: e:0\nevent: execution.started\ndata: {"sequence":0}\n\n',
        ),
      );
    },
  });
  const response = await forward(
    new Request('https://console.invalid/api/v1/chat', {
      method: 'POST',
      body: JSON.stringify({
        profile: 'chat-default@1',
        input: {
          messages: [
            {
              role: 'user',
              content: [{ type: 'text', text: 'hello' }],
            },
          ],
        },
        stream: true,
      }),
      headers: {
        Cookie: cookie,
        Origin: 'https://console.invalid',
        Accept: 'text/event-stream',
        'Content-Type': 'application/json',
        'Idempotency-Key': 'm2-stream-bff',
      },
    }),
    ['v1', 'chat'],
    runtime,
    async (input, init) => {
      assert.equal(new URL(String(input)).pathname, '/v1/chat');
      const headers = new Headers(init?.headers);
      assert.equal(headers.get('Accept'), 'text/event-stream');
      assert.equal(headers.get('Authorization'), 'Bearer server-access');
      return new Response(upstream, {
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream',
          'X-Request-ID': 'm2-stream-request',
        },
      });
    },
  );
  assert.equal(response.status, 200);
  assert.equal(
    response.headers.get('content-type'),
    'text/event-stream; charset=utf-8',
  );
  assert.equal(response.headers.get('x-request-id'), 'm2-stream-request');
  const reader = response.body!.getReader();
  const first = await reader.read();
  assert.match(new TextDecoder().decode(first.value), /execution\.started/);

  let secondResolved = false;
  const secondRead = reader.read().then((value) => {
    secondResolved = true;
    return value;
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(secondResolved, false);

  controller.enqueue(
    encoder.encode(
      'id: e:1\nevent: model.delta\ndata: {"sequence":1,"text":"hi"}\n\n',
    ),
  );
  controller.close();
  const second = await secondRead;
  assert.match(new TextDecoder().decode(second.value), /model\.delta/);
  assert.equal((await reader.read()).done, true);
});
test('BFF maps generic browser execution submission to the public runtime route', async () => {
  const { runtime, cookie } = await fixture();
  const response = await forward(
    new Request('https://console.invalid/api/v1/executions', {
      method: 'POST',
      body: JSON.stringify({
        profile: 'chat-default@1',
        capability: 'chat',
        input: {
          messages: [
            {
              role: 'user',
              content: [{ type: 'text', text: 'hello' }],
            },
          ],
        },
      }),
      headers: {
        Cookie: cookie,
        Origin: 'https://console.invalid',
        'Content-Type': 'application/json',
        'Idempotency-Key': 'm2-generic-execution',
      },
    }),
    ['v1', 'executions'],
    runtime,
    async (input, init) => {
      assert.equal(new URL(String(input)).pathname, '/v1/executions');
      assert.equal(
        new Headers(init?.headers).get('Authorization'),
        'Bearer server-access',
      );
      return Response.json({
        executionId: '00000000-0000-4000-8000-000000000301',
        status: 'COMPLETED',
        replayed: false,
        provider: 'openrouter',
        model: 'fixture-model',
        result: { kind: 'text', text: 'hello' },
        usage: {
          inputTokens: 1,
          outputTokens: 1,
          totalTokens: 2,
          completeness: 'complete',
        },
        requestId: 'provider-1',
        finishReason: 'stop',
        links: {
          self: '/v1/executions/00000000-0000-4000-8000-000000000301',
          events: '/v1/executions/00000000-0000-4000-8000-000000000301/events',
        },
      });
    },
  );
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal((await response.json()).status, 'COMPLETED');
});
