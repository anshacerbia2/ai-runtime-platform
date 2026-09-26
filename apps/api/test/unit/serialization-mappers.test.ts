import test from 'node:test';
import assert from 'node:assert/strict';
import { databaseJson } from '../../src/shared/infrastructure/json-value.js';
import {
  presentAudit,
  presentRunner,
} from '../../src/modules/control-plane/infrastructure/wire-mappers.js';
import { ManagementResult, ConnectionRecord } from '@ai-runtime/contracts/http';

test('database JSON boundary rejects non-JSON representations and bounds depth and bytes', () => {
  for (const value of [
    undefined,
    NaN,
    Infinity,
    1n,
    new Date(),
    { x: undefined },
    [undefined],
    {
      toJSON() {
        return {};
      },
    },
  ]) {
    assert.throws(() => databaseJson(value));
  }
  const cyclic: { self?: unknown } = {};
  cyclic.self = cyclic;
  assert.throws(() => databaseJson(cyclic));
  assert.throws(() => databaseJson({ large: 'x'.repeat(1024) }, 64));
  const valid = { n: 4, nullable: null, yes: true, array: ['text', 1] };
  assert.equal(databaseJson(valid), valid);
});

test('explicit audit and runner mappers omit extra fields and preserve timestamps', () => {
  const createdAt = new Date('2026-09-24T00:00:00.000Z');
  const row = {
    id: 'event',
    applicationId: null,
    actor: 'operator',
    action: 'fixture',
    resourceId: 'resource',
    revision: 1,
    createdAt,
    secretRef: 'never-public',
  };
  const projected = presentAudit(row);
  assert.equal(projected.createdAt, createdAt.toISOString());
  assert.equal('secretRef' in projected, false);
  const runner = {
    id: 'runner',
    ownerSubject: 'owner',
    poolId: 'pool',
    version: '1.0.0',
    capabilities: ['chat'],
    connectionIds: [],
    capacity: 1,
    status: 'RUNNING',
    revision: 1,
    lastHeartbeatAt: createdAt,
    secretRef: 'never-public',
  };
  assert.equal('secretRef' in presentRunner(runner), false);
});

test('tagged management response cannot change resource kind after additive fields', () => {
  const connection = {
    kind: 'connection',
    id: 'connection-1',
    displayName: 'Fixture',
    environment: 'local',
    provider: 'fixture',
    authMode: 'API_KEY',
    sharingMode: 'DEDICATED',
    quotaGroupRef: null,
    gatewayMaxConcurrency: 100,
    gatewayRequestsPerMinute: 600,
    status: 'ENABLED',
    revision: 1,
    keycloakClientId: 'future-optional-field',
  };
  const result = ManagementResult.parse(connection);
  assert.equal(result.kind, 'connection');
  if (result.kind === 'connection') {
    assert.equal(result.provider, 'fixture');
  }
  assert.equal(ConnectionRecord.parse(connection).provider, 'fixture');
  assert.equal(
    ManagementResult.safeParse({ ...connection, kind: 'unknown' }).success,
    false,
  );
});

test('JSON byte bounds match actual encoding including Unicode and escaping', () => {
  for (const value of [
    { text: 'x'.repeat(14000) },
    { text: '日本😀' + String.fromCharCode(34, 92, 10, 0) },
    { text: '\ud800' },
    { a: 0, b: 1e30, c: [true, false, null] },
  ]) {
    const size = Buffer.byteLength(JSON.stringify(value), 'utf8');
    assert.equal(databaseJson(value, size), value);
    assert.throws(() => databaseJson(value, size - 1));
  }
  let accessed = false;
  const withGetter = {
    get secret() {
      accessed = true;
      return 'hidden';
    },
  };
  assert.throws(() => databaseJson(withGetter));
  assert.equal(accessed, false);
});
