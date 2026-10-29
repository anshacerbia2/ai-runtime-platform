import assert from 'node:assert/strict';
import test from 'node:test';
import { apiContract, browserContract } from '../src/http/index.js';
import {
  ConnectionUsageQuery,
  ConnectionUsageSummary,
} from '../src/http/connection-usage.js';

test('connection usage requires a bounded precise time window and explicit account selection', () => {
  const from = '2026-10-01T00:00:00.000Z';
  const to = '2026-10-02T00:00:00.000Z';
  assert.equal(ConnectionUsageQuery.safeParse({ from, to }).success, true);
  assert.equal(
    ConnectionUsageQuery.safeParse({
      from,
      to,
      applicationId: 'app-a',
      budgetAccountId: 'budget-a',
    }).success,
    true,
  );
  for (const query of [
    {},
    { from, to: from },
    { from: to, to: from },
    { from, to: '2026-11-02T00:00:00.000Z' },
    { from: '2026-10-01', to },
    { from: '2026-10-01T00:00:00.000001Z', to },
    { from, to, credentialRef: 'secret:other' },
    { from, to, budgetAccountId: '../other' },
  ]) {
    assert.equal(ConnectionUsageQuery.safeParse(query).success, false);
  }
  assert.equal(apiContract.resources.connections.usage.method, 'GET');
  assert.equal(
    browserContract.resources.connections.usage.path,
    '/api/v1/connections/:id/usage',
  );
});

test('connection usage preserves unknown counters and exact decimal aggregates without a synthetic bill', () => {
  const value = {
    connectionId: 'account-a',
    applicationId: null,
    from: '2026-10-01T00:00:00.000Z',
    to: '2026-10-02T00:00:00.000Z',
    observedAt: '2026-10-03T00:00:00.000Z',
    consistency: 'repeatable-read',
    invocations: {
      total: '2',
      running: '0',
      succeeded: '1',
      failed: '0',
      unknown: '1',
    },
    tokens: {
      input: { known: '9007199254740993', unknownInvocations: '0' },
      output: { known: '0', unknownInvocations: '2' },
    },
    ledger: null,
  };
  assert.equal(ConnectionUsageSummary.safeParse(value).success, true);
  assert.equal(
    ConnectionUsageSummary.safeParse({
      ...value,
      tokens: {
        ...value.tokens,
        input: { known: 9007199254740992, unknownInvocations: '0' },
      },
    }).success,
    false,
  );
  assert.equal(
    ConnectionUsageSummary.safeParse({
      ...value,
      ledger: {
        accountId: 'budget-a',
        unit: 'internal-budget-unit',
        attributedPostedUnits: '-2',
        excludedObservationCount: '1',
      },
    }).success,
    true,
  );
});
