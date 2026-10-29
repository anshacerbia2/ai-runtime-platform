import assert from 'node:assert/strict';
import test from 'node:test';
import {
  captureProviderCredentialBindings,
  parseProviderCredentialBindings,
} from '../../config/provider-credentials.mjs';

const entry = {
  connectionId: 'account-a',
  provider: 'openrouter',
  credentialRef: 'secret:account-a/v1',
  apiKey: 'fixture-secret',
};
test('provider credentials are bounded explicit bindings captured independently of caller mutations', () => {
  const raw = { ...entry };
  const parsed = captureProviderCredentialBindings([raw]);
  raw.apiKey = 'changed';
  assert.equal(parsed[0].apiKey, entry.apiKey);
  assert.ok(Object.isFrozen(parsed) && Object.isFrozen(parsed[0]));
  assert.deepEqual(
    parseProviderCredentialBindings(JSON.stringify([entry])),
    parsed,
  );
});
test('invalid credential configuration never echoes secrets, including malformed JSON and schema errors', () => {
  for (const raw of [
    '{"apiKey":"fixture-secret"',
    JSON.stringify([entry, entry]),
    JSON.stringify([{ ...entry, token: 'fixture-secret' }]),
    JSON.stringify([{ ...entry, provider: 'unsupported' }]),
    JSON.stringify([{ ...entry, apiKey: 'header\r\ninjection' }]),
    JSON.stringify(
      Array.from({ length: 65 }, (_, i) => ({
        ...entry,
        connectionId: `account-${i}`,
      })),
    ),
    ' '.repeat(65537),
  ]) {
    assert.throws(
      () => parseProviderCredentialBindings(raw),
      (error) =>
        error instanceof Error &&
        error.message === 'Invalid M2_PROVIDER_CREDENTIALS_JSON.' &&
        !error.stack.includes('fixture-secret'),
    );
  }
});
test('one shared reference cannot alias another connection or provider; only exact duplicate triples conflict', () => {
  const values = [
    entry,
    { ...entry, connectionId: 'account-b', apiKey: 'other-key' },
    { ...entry, provider: 'direct-anthropic', apiKey: 'anthropic-key' },
  ];
  assert.equal(
    parseProviderCredentialBindings(JSON.stringify(values)).length,
    3,
  );
  assert.deepEqual(parseProviderCredentialBindings(undefined), []);
});
