import assert from 'node:assert/strict';
import test from 'node:test';
import type { DatabaseService } from '../../src/infrastructure/database/database.service.js';
import type { RunnerPresenceStore } from '../../src/modules/control-plane/application/runner-presence-store.port.js';
import { PrismaResourceReader } from '../../src/modules/control-plane/infrastructure/prisma-resource-reader.js';

const principal = {
  subject: 'operator',
  kind: 'operator' as const,
  roles: ['platform-admin'],
  scopes: ['platform:read'],
};

test('runner list derives liveness from current presence without changing durable lifecycle', async () => {
  const old = new Date('2020-01-01T00:00:00.000Z');
  const rows = ['alive', 'missing', 'superseded', 'stale', 'lookahead'].map(
    (id) => ({
      id,
      ownerSubject: 'owner',
      poolId: 'pool',
      version: '1.0.0',
      capabilities: ['agent_execute'],
      connectionIds: [],
      capacity: 1,
      status: id === 'missing' ? 'DRAINING' : 'RUNNING',
      revision: 2,
      lastHeartbeatAt: old,
    }),
  );
  const inspected: string[] = [];
  const presence = {
    async inspect(registration) {
      inspected.push(registration.runnerId);
      assert.equal(registration.registrationRevision, 2);
      if (registration.runnerId === 'stale') {
        throw new Error('Redis unavailable');
      }
      return registration.runnerId === 'alive'
        ? 'CURRENT'
        : registration.runnerId === 'superseded'
          ? 'MISMATCH'
          : 'MISSING';
    },
  } as RunnerPresenceStore;
  const db = {
    runnerNode: {
      async findMany() {
        return rows;
      },
    },
  } as unknown as DatabaseService;
  const reader = new PrismaResourceReader(db, presence);

  const result = await reader.list(principal, 'runners', { limit: '4' });
  assert.deepEqual(
    result.items.map(({ id, status, liveness }) => ({ id, status, liveness })),
    [
      { id: 'alive', status: 'RUNNING', liveness: 'ALIVE' },
      { id: 'missing', status: 'DRAINING', liveness: 'OFFLINE' },
      { id: 'superseded', status: 'RUNNING', liveness: 'OFFLINE' },
      { id: 'stale', status: 'RUNNING', liveness: 'UNKNOWN' },
    ],
  );
  assert.ok(result.nextCursor);
  assert.deepEqual(inspected, ['alive', 'missing', 'superseded', 'stale']);
  assert.equal(result.items[0]?.lastHeartbeatAt, old.toISOString());
});
