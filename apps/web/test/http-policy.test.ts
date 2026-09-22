import test from 'node:test';
import assert from 'node:assert/strict';
import { browserPolicy } from '../src/server/http/page-policy';
import { boundedBody, cookieValue } from '../src/server/http/security';
import { fixtureConfig } from './fixtures';

test('G36 CSP permits only the configured HTTPS issuer for form redirects and still denies framing', () => {
  const policy = browserPolicy(fixtureConfig());
  assert.match(policy, /frame-ancestors 'none'/);
  assert.match(policy, /form-action 'self' https:\/\/issuer.invalid$/);
  assert.equal(policy.includes('fixture-client-secret'), false);
  assert.equal(policy.includes('*'), false);
});

test('G37 duplicate session cookies are rejected rather than selected by ordering', () => {
  const request = new Request('https://console.invalid', {
    headers: { Cookie: '__Host-unit=first; __Host-unit=second' },
  });
  assert.equal(cookieValue(request, '__Host-unit'), '');
});

test('slow request bodies stop on the caller deadline', async () => {
  const controller = new AbortController();
  const stream = new ReadableStream<Uint8Array>();
  const reading = boundedBody(stream, 1024, controller.signal);
  controller.abort();
  await assert.rejects(reading, /REQUEST_TIMEOUT/);
});
