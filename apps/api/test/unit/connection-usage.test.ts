import assert from 'node:assert/strict';
import test from 'node:test';
import type { Principal } from '../../src/modules/identity/domain/principal.js';
import { ConnectionUsageService } from '../../src/modules/control-plane/application/connection-usage.service.js';
import { ApplicationError } from '../../src/shared/domain/application-error.js';
import { ContractConnectionUsageQueryValidator } from '../../src/modules/control-plane/infrastructure/connection-usage-query.validator.js';

const operator: Principal = {
  subject: 'operator',
  kind: 'operator',
  scopes: ['platform:read'],
  roles: ['platform-operator'],
};
const query = {
  from: '2026-10-01T00:00:00.000Z',
  to: '2026-10-02T00:00:00.000Z',
};

test('connection usage authorizes operator reads before accessing storage', async () => {
  let calls = 0;
  const service = new ConnectionUsageService(
    {
      async read() {
        calls++;
        return null;
      },
    },
    new ContractConnectionUsageQueryValidator(),
  );
  for (const denied of [
    { ...operator, kind: 'application' as const },
    { ...operator, kind: 'runner' as const },
    { ...operator, scopes: [] },
    { ...operator, roles: [] },
  ]) {
    await assert.rejects(
      () => service.read(denied, 'account-a', query),
      (e) => e instanceof ApplicationError && e.code === 'POLICY_DENIED',
    );
  }
  assert.equal(calls, 0);
  await assert.rejects(
    () => service.read(operator, 'account-a', query),
    (e) => e instanceof ApplicationError && e.code === 'NOT_FOUND',
  );
  assert.equal(calls, 1);
});

test('connection usage rejects invalid identifiers, windows and unknown query fields before storage', async () => {
  let calls = 0;
  const service = new ConnectionUsageService(
    {
      async read(id, parsed) {
        calls++;
        assert.equal(id, 'account-a');
        assert.deepEqual(parsed, query);
        return null;
      },
    },
    new ContractConnectionUsageQueryValidator(),
  );
  for (const [id, input] of [
    ['../account', query],
    ['account-a', {}],
    ['account-a', { ...query, to: query.from }],
    ['account-a', { ...query, application_id: 'spoofed' }],
  ] as const) {
    await assert.rejects(
      () => service.read(operator, id, input),
      (e) => e instanceof ApplicationError && e.code === 'INVALID_REQUEST',
    );
  }
  assert.equal(calls, 0);
  await assert.rejects(
    () => service.read(operator, 'account-a', query),
    (e) => e instanceof ApplicationError && e.code === 'NOT_FOUND',
  );
  assert.equal(calls, 1);
});
