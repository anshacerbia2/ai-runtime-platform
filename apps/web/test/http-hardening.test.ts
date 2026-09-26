import assert from 'node:assert/strict';
import test from 'node:test';
import { createApiClient } from '../src/shared/api/api-client';

const profile = {
  profile: 'test',
  capability: 'chat',
  workload_class: 'interactive',
  execution_path: 'gateway',
  runtime_adapter: null,
  provider_adapter: 'openrouter',
  harness_ref: null,
  limits: { max_output_tokens: 100, timeout_ms: 1000, future_limit: 7 },
  streaming: false,
  mode: 'contract-only',
  title: 'Test',
  description: 'Test',
  future_property: true,
};

test('older HTTP consumer accepts additive nested profile fields without exposing them', async () => {
  const client = createApiClient(async () =>
    Response.json({ items: [profile], future: true }),
  );
  const result = await client.lab.profiles();
  assert.equal(result.status, 200);
  if (result.status !== 200) {
    throw new Error('Unexpected status');
  }
  assert.equal(result.body.items[0].profile, 'test');
  assert.equal('future_property' in result.body.items[0], false);
  assert.equal('future_limit' in result.body.items[0].limits, false);
});
