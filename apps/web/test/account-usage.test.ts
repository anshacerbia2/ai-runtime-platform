import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildUsageQuery,
  formatUsageInteger,
  recentUsageWindow,
  usageQueryKey,
} from '../src/features/control-plane/usage-model';
import { createApiClient } from '../src/shared/api/api-client';
import { readConnectionUsage } from '../src/shared/api/control-plane-client';
import { ApiClientError } from '../src/shared/api/http-error';

test('usage filters interpret form times as UTC, preserve scope and reject invalid windows', () => {
  const query = buildUsageQuery(
    '2026-10-01T00:00',
    '2026-10-02T01:02:03.4',
    'app-a',
    'budget-a',
  );
  assert.deepEqual(query, {
    from: '2026-10-01T00:00:00.000Z',
    to: '2026-10-02T01:02:03.400Z',
    applicationId: 'app-a',
    budgetAccountId: 'budget-a',
  });
  for (const [from, to] of [
    ['2026-02-30T00:00', '2026-03-03T00:00'],
    ['2026-10-02T00:00', '2026-10-01T00:00'],
    ['2026-10-01T00:00', '2026-11-02T00:00'],
    ['broken', '2026-10-01T00:00'],
  ]) {
    assert.throws(() => buildUsageQuery(from!, to!));
  }
  assert.deepEqual(recentUsageWindow(Date.parse('2026-10-02T12:34:56.789Z')), {
    from: '2026-10-01T12:34:56.789',
    to: '2026-10-02T12:34:56.789',
  });
  const key = usageQueryKey('account-a', query);
  assert.notEqual(key, usageQueryKey('account-b', query));
  assert.notEqual(
    key,
    usageQueryKey('account-a', { ...query, budgetAccountId: 'budget-b' }),
  );
  assert.notEqual(
    key,
    usageQueryKey('account-a', { ...query, applicationId: 'app-b' }),
  );
});

test('usage number formatting never rounds exact counters or correction deltas', () => {
  assert.equal(formatUsageInteger('9007199254740993'), '9,007,199,254,740,993');
  assert.equal(
    formatUsageInteger('-9007199254740993'),
    '-9,007,199,254,740,993',
  );
  assert.equal(formatUsageInteger('0'), '0');
  assert.throws(() => formatUsageInteger('1.5'));
});

test('usage client uses the shared route and refuses responses for another account or applied filter', async () => {
  const query = {
    from: '2026-10-01T00:00:00.000Z',
    to: '2026-10-02T00:00:00.000Z',
  };
  const payload = {
    connectionId: 'account-a',
    applicationId: null,
    ...query,
    observedAt: query.to,
    consistency: 'repeatable-read',
    invocations: {
      total: '1',
      running: '0',
      succeeded: '0',
      failed: '0',
      unknown: '1',
    },
    tokens: {
      input: { known: '9007199254740993', unknownInvocations: '0' },
      output: { known: '0', unknownInvocations: '1' },
    },
    ledger: null,
  };
  const client = createApiClient(async (input) => {
    const url = new URL(String(input), 'https://console.invalid');
    assert.equal(url.pathname, '/api/v1/connections/account-a/usage');
    assert.equal(url.searchParams.get('from'), query.from);
    return Response.json(payload);
  });
  assert.equal(
    (await readConnectionUsage('account-a', query, undefined, client)).tokens
      .input.known,
    '9007199254740993',
  );
  for (const wrong of [
    { ...payload, connectionId: 'account-b' },
    { ...payload, applicationId: 'app-b' },
    { ...payload, to: '2026-10-03T00:00:00.000Z' },
    {
      ...payload,
      ledger: {
        accountId: 'budget-b',
        unit: 'tokens',
        attributedPostedUnits: '1',
        excludedObservationCount: '0',
      },
    },
  ]) {
    await assert.rejects(
      () =>
        readConnectionUsage(
          'account-a',
          query,
          undefined,
          createApiClient(async () => Response.json(wrong)),
        ),
      (error) =>
        error instanceof ApiClientError && error.kind === 'invalid-response',
    );
  }
});
