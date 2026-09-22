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
        { error: { code: 'CONFLICT' } },
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
        return Response.json({ ok: true });
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
