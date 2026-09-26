import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { z } from 'zod';
import { assertProjectionSafeResponseSource } from '../src/http/response-policy.js';
import {
  examples,
  validateContract,
  ChatRequest,
  Snapshot,
  Event,
  Profile,
  profiles,
  canonicalJson,
  validateSnapshot,
  schemaBundle,
} from '../src/index.js';
function object(value: unknown): Record<string, unknown> {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value));
  return value as Record<string, unknown>;
}

const example = (id: string) =>
  structuredClone(examples.find((x) => x.id === id)!);
for (const id of ['chat', 'structured', 'scribe']) {
  test('documented fixture: ' + id, () => {
    const e = example(id);
    assert.equal(validateContract(e.kind, e.payload).valid, true);
  });
}
test('direct chat needs no process, plugin, or business job', () => {
  const e = example('chat');
  assert.equal(validateContract(e.kind, e.payload).valid, true);
});
for (const field of [
  'application_id',
  'tenant_id',
  'provider',
  'pluginDir',
  'allowedTools',
]) {
  test('reject caller authority: ' + field, () => {
    const e = example('chat');
    object(e.payload)[field] = 'untrusted';
    assert.equal(validateContract(e.kind, e.payload).valid, false);
  });
}
test('do not coerce a numeric string limit', () => {
  const e = example('chat');
  object(e.payload).constraints = { max_output_tokens: '50' };
  assert.equal(validateContract(e.kind, e.payload).valid, false);
});
test('constraints may only decrease profile bounds', () => {
  const e = example('chat');
  object(e.payload).constraints = { max_output_tokens: 9999 };
  assert.equal(
    validateContract(e.kind, e.payload).issues[0]?.code,
    'POLICY_DENIED',
  );
  object(e.payload).constraints = { max_output_tokens: 50 };
  assert.equal(validateContract(e.kind, e.payload).valid, true);
});
test('reject capability/profile mismatch', () => {
  const e = example('scribe');
  object(e.payload).profile = 'chat-default@1';
  assert.equal(validateContract(e.kind, e.payload).valid, false);
});
test('no silent session support', () => {
  const e = example('chat');
  object(e.payload).session_ref = 'session-1';
  assert.equal(validateContract(e.kind, e.payload).valid, false);
});
test('unknown profile never invokes a fallback', () => {
  const e = example('chat');
  object(e.payload).profile = 'not-a-profile';
  assert.equal(
    validateContract(e.kind, e.payload).issues[0]?.code,
    'PROFILE_NOT_FOUND',
  );
});
test('remote schema references are rejected without fetching', () => {
  const e = example('structured');
  object(object(e.payload).input).response_schema = {
    $ref: 'https://example.invalid/schema',
  };
  assert.equal(
    validateContract(e.kind, e.payload).issues[0]?.code,
    'SCHEMA_KEYWORD_NOT_ALLOWED',
  );
});
test('invalid response-schema required is rejected', () => {
  const e = example('structured');
  object(object(object(e.payload).input).response_schema).required = ['absent'];
  assert.equal(validateContract(e.kind, e.payload).valid, false);
});
test('schema recursion bounded', () => {
  const e = example('structured');
  let s: Record<string, unknown> = { type: 'string' };
  for (let i = 0; i < 12; i++) {
    s = { type: 'object', properties: { next: s } };
  }
  object(object(e.payload).input).response_schema = s;
  assert.equal(validateContract(e.kind, e.payload).valid, false);
});
test('large input rejected', () => {
  const e = example('chat');
  const request = ChatRequest.parse(e.payload);
  request.input.messages = [
    { role: 'user', content: [{ type: 'text', text: 'x'.repeat(24001) }] },
  ];
  e.payload = request;
  assert.equal(validateContract(e.kind, e.payload).valid, false);
});
test('every demo profile follows its own explicitly local contract', () =>
  profiles.forEach((p) => assert.equal(Profile.safeParse(p).success, true)));
const snapshot: z.infer<typeof Snapshot> = {
  execution_id: 'exec-1',
  revision: 1,
  status: 'COMPLETED',
  status_reason: null,
  profile_revision: 'chat-default@1',
  attempts: [
    {
      attempt_id: 'attempt-1',
      status: 'SUCCEEDED',
      authority: 'RELEASED',
      local_compute: 'NOT_APPLICABLE',
      external_operations: 'NONE',
      accounting: 'PENDING_RECONCILIATION',
    },
  ],
  result: { kind: 'text', text: 'fixture', artifact_refs: [] },
  usage: {
    measurement_status: 'partial',
    cost_basis: 'unknown',
    provider_cost: null,
  },
  links: {
    self: '/v1/executions/exec-1',
    events: '/v1/executions/exec-1/events',
  },
};
test('completion is independent of settlement', () =>
  assert.equal(validateSnapshot(snapshot), true));
test('COMPLETED without result is rejected by semantic validation', () =>
  assert.equal(validateSnapshot({ ...snapshot, result: null }), false));
test('ordinary failed exit does not need SIGKILL', () => {
  const s = structuredClone(snapshot);
  s.status = 'FAILED';
  s.result = null;
  s.attempts[0]!.status = 'FAILED';
  s.attempts[0]!.local_compute = 'EXITED';
  assert.equal(validateSnapshot(s), true);
});
test('canonical documented event parses', () =>
  assert.equal(
    Event.safeParse({
      schema_version: '1',
      event_id: 'event-123',
      execution_id: 'exec-123',
      attempt_id: 'attempt-1',
      stream_epoch: 'epoch-1',
      sequence: 12,
      type: 'model.delta',
      occurred_at: '2026-09-20T00:00:00Z',
      payload: { text: 'Hasil' },
    }).success,
    true,
  ));
test('unknown event not silently treated as success', () =>
  assert.equal(Event.safeParse({ type: 'new.success' }).success, false));
test('request digest independent of JSON object key order', () =>
  assert.equal(canonicalJson({ a: 1, b: 2 }), canonicalJson({ b: 2, a: 1 })));
test('all schema exports are JSON serializable', () =>
  assert.ok(JSON.stringify(schemaBundle).length > 1000));

for (const [name, schema] of Object.entries({
  badNumeric: { type: 'integer', minimum: '1' },
  inverted: { type: 'string', minLength: 4, maxLength: 2 },
  wrongCount: { type: 'array', maxItems: 2.5 },
  wrongProperties: { type: 'string', properties: { x: { type: 'string' } } },
})) {
  test('bounded schema rejects ' + name, () => {
    const item = object(
      structuredClone(examples.find((x) => x.id === 'structured')!.payload),
    );
    object(item.input).response_schema = schema;
    assert.equal(validateContract('generate', item).valid, false);
  });
}

test('HTTP wire schemas remain projection-only and non-mutating', () => {
  const files = [
    'routes.ts',
    'lab.ts',
    'control-plane.ts',
    'gateway.ts',
    'resources.ts',
    'runner.ts',
  ];
  for (const name of files) {
    const source = readFileSync(
      resolve('packages/contracts/src/http', name),
      'utf8',
    );
    assert.doesNotThrow(() => assertProjectionSafeResponseSource(source), name);
  }
});
