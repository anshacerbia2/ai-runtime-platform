import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { ToolOperationStatusService } from '../../src/modules/tool-effects/application/tool-operation-status.service.js';
import type { Principal } from '../../src/modules/identity/domain/principal.js';
import { ApplicationError } from '../../src/shared/domain/application-error.js';

const allowed: Principal = {
  subject: 'app-client',
  kind: 'application',
  applicationId: 'app-one',
  scopes: ['execution:read'],
  roles: [],
};
test('tool status requires application read scope and binding before storage access', async () => {
  let calls = 0;
  const service = new ToolOperationStatusService({
    async read() {
      calls++;
      return null;
    },
    async list() {
      calls++;
      return {
        items: [],
        nextAfter: null,
        limit: 25,
        consistency: 'live-keyset',
      };
    },
  });
  for (const denied of [
    { ...allowed, kind: 'operator' as const },
    { ...allowed, kind: 'runner' as const },
    { ...allowed, scopes: [] },
    { ...allowed, applicationId: undefined },
    { ...allowed, applicationId: '' },
  ]) {
    for (const read of [
      () => service.read(denied, randomUUID(), randomUUID()),
      () => service.list(denied, randomUUID(), {}),
    ]) {
      await assert.rejects(
        async () => read(),
        (error) =>
          error instanceof ApplicationError && error.code === 'POLICY_DENIED',
      );
    }
  }
  assert.equal(calls, 0);
  await assert.rejects(
    () => service.read(allowed, randomUUID(), randomUUID()),
    (error) => error instanceof ApplicationError && error.code === 'NOT_FOUND',
  );
  assert.equal(calls, 1);
});

test('tool status validates identifiers and pagination before storage access', async () => {
  let calls = 0;
  const service = new ToolOperationStatusService({
    async read() {
      calls++;
      return null;
    },
    async list(applicationId, executionId, query) {
      calls++;
      assert.equal(applicationId, allowed.applicationId);
      assert.ok(executionId);
      assert.deepEqual(query, { limit: 25 });
      return {
        items: [],
        nextAfter: null,
        limit: 25,
        consistency: 'live-keyset',
      };
    },
  });
  for (const read of [
    () => service.read(allowed, 'invalid', randomUUID()),
    () => service.read(allowed, randomUUID(), 'invalid'),
    () => service.list(allowed, randomUUID(), { limit: '101' }),
  ]) {
    await assert.rejects(
      async () => read(),
      (error) =>
        error instanceof ApplicationError && error.code === 'INVALID_REQUEST',
    );
  }
  assert.equal(calls, 0);
  await service.list(allowed, randomUUID(), {});
  assert.equal(calls, 1);
});
