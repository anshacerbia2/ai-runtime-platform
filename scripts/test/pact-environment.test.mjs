import assert from 'node:assert/strict';
import test from 'node:test';
import { loadPactEnvironment } from '../../config/environment.mjs';

const fixture = {
  PACT_BROKER_BASE_URL: 'http://127.0.0.1:9292',
  PACT_VERSION: 'a'.repeat(40),
  PACT_BRANCH: 'test',
  PACT_ENVIRONMENT: 'contract-ci',
  PACT_TIMEOUT_MS: '5000',
};
function usingEnv(values, operation) {
  const previous = new Map(
    Object.keys(values).map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, values);
  try {
    operation();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test('Pact delivery requires exact versions, explicit environment, secure Broker and no bypasses', () => {
  usingEnv(fixture, () => {
    assert.equal(loadPactEnvironment().version, fixture.PACT_VERSION);
    for (const changed of [
      { PACT_VERSION: 'latest' },
      { PACT_ENVIRONMENT: '' },
      { PACT_BROKER_BASE_URL: 'http://public.invalid' },
      { PACT_BROKER_BASE_URL: 'https://broker.invalid', PACT_BROKER_TOKEN: '' },
      { PACT_BROKER_CAN_I_DEPLOY_DRY_RUN: 'true' },
      { PACT_BROKER_CAN_I_DEPLOY_IGNORE: 'runtime-console' },
    ]) {
      usingEnv(changed, () => assert.throws(() => loadPactEnvironment()));
    }
  });
});
