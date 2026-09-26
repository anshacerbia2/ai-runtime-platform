import assert from 'node:assert/strict';
import test from 'node:test';
import {
  apiContract,
  browserContract,
  httpOpenApi,
} from '@ai-runtime/contracts/http';

test('OpenAPI distinguishes provider bearer authority from browser-owned sessions', () => {
  const provider = httpOpenApi(apiContract, 'Provider', 'test');
  assert.deepEqual(provider.security, [{ PlatformBearer: [] }]);
  assert.deepEqual(
    (provider.paths['/health/live'].get as Record<string, unknown>).security,
    [],
  );
  const browser = httpOpenApi(browserContract, 'Browser', 'test', {
    boundary: 'browser',
    sessionCookieName: '__Host-fixture-session',
  });
  assert.deepEqual(browser.security, [{ BrowserSession: [] }]);
  const schemes = browser.components.securitySchemes;
  const session = schemes.BrowserSession;
  assert.ok(session);
  assert.equal(session.in, 'cookie');
  assert.equal(session.name, '__Host-fixture-session');
  assert.equal('PlatformBearer' in schemes, false);
  assert.equal('/api/runner/v1/reports' in browser.paths, false);
});

test('exported response readers permit additive properties while retaining required known fields', () => {
  const doc = httpOpenApi(apiContract, 'Provider', 'test');
  const op = doc.paths['/api/m0/health'].get as {
    responses: Record<
      string,
      {
        headers: Record<string, unknown>;
        content: Record<
          string,
          { schema: { required: string[]; additionalProperties?: boolean } }
        >;
      }
    >;
  };
  const schema = op.responses['200'].content['application/json'].schema;
  assert.ok(schema.required.includes('saved_checks'));
  assert.notEqual(schema.additionalProperties, false);
  assert.ok(op.responses['200'].headers['X-Request-ID']);
  assert.ok(op.responses['503'].headers['Retry-After']);
});

test('retired snapshot advertises migration without falsely deprecating the live admission API', () => {
  const doc = httpOpenApi(apiContract, 'Provider', 'test');
  assert.equal(
    (doc.paths['/api/m1/control-plane'].get as Record<string, unknown>)
      .deprecated,
    true,
  );
  assert.equal(
    (doc.paths['/api/m1/admissions'].post as Record<string, unknown>)
      .deprecated,
    undefined,
  );
});
