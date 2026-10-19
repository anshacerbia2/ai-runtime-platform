import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import {
  apiContract,
  browserContract,
  contractRoutes,
} from '../src/http/index.js';
import {
  ToolOperationStatus,
  ToolOperationQuery,
} from '../src/http/tool-operations.js';

test('tool status preserves uncertainty and requires terminal receipt pairs', () => {
  const base = {
    operationId: randomUUID(),
    executionId: randomUUID(),
    toolRef: 'fixture:write',
    requestDigest: 'a'.repeat(64),
    receiverRetentionUntil: '2026-10-19T12:00:00.000Z',
    updatedAt: '2026-10-19T11:00:00.000Z',
  };
  for (const state of ['PREPARED', 'DISPATCHING', 'UNKNOWN']) {
    assert.equal(
      ToolOperationStatus.safeParse({ ...base, state, receipt: null }).success,
      true,
    );
    assert.equal(
      ToolOperationStatus.safeParse({
        ...base,
        state,
        receipt: { ref: 'receipt:one', digest: 'b'.repeat(64) },
      }).success,
      false,
    );
  }
  for (const state of ['COMMITTED', 'NO_EFFECT']) {
    assert.equal(
      ToolOperationStatus.safeParse({ ...base, state, receipt: null }).success,
      false,
    );
    assert.equal(
      ToolOperationStatus.safeParse({
        ...base,
        state,
        receipt: { ref: 'receipt:one', digest: 'b'.repeat(64) },
      }).success,
      true,
    );
  }
  assert.equal(
    ToolOperationStatus.safeParse({ ...base, state: 'FAILED', receipt: null })
      .success,
    false,
  );
});

test('tool status reads are bounded and explicitly backend-only', () => {
  for (const query of [
    { limit: '0' },
    { limit: '101' },
    { after: 'bad' },
    { application_id: 'other' },
  ]) {
    assert.equal(ToolOperationQuery.safeParse(query).success, false);
  }
  assert.equal(
    ToolOperationQuery.safeParse({ limit: '100', after: randomUUID() }).success,
    true,
  );
  const routes = [
    apiContract.toolOperations.list,
    apiContract.toolOperations.status,
  ];
  assert.ok(routes.every((route) => route.method === 'GET'));
  assert.ok(
    contractRoutes(browserContract).every(
      (route) => !routes.some((tool) => route.path === tool.path),
    ),
  );
});
