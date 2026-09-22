import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { loadSessionTestEnvironment } from '../../../config/environment.mjs';
import { createSessionStore } from '../src/server/session/redis-store';
import { SessionManager } from '../src/server/session/manager';
import { policy, secret, user } from './fixtures';

// This suite requires an explicitly configured disposable, loopback Redis.
// It deletes only its own random keys; it never flushes a database.
test('Redis session operations are atomic across independent clients', async () => {
  const config = loadSessionTestEnvironment();
  const first = await createSessionStore(config.url, config.timeoutMs);
  const second = await createSessionStore(config.url, config.timeoutMs);
  const namespace = 'bff-test-' + randomUUID();
  const keys = new Set<string>();
  const key = (name: string) => {
    const value = namespace + ':' + name;
    keys.add(value);
    return value;
  };
  try {
    const nx = key('nx');
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        (index % 2 ? first : second).create(nx, 'owner-' + index, 10000),
      ),
    );
    assert.equal(results.filter(Boolean).length, 1);
    const owner = await first.get(nx);
    assert.ok(owner);
    assert.equal(await second.replace(nx, 'wrong', 'next', 10000), false);
    assert.equal(await second.replace(nx, owner, 'next', 10000), true);
    await first.removeIf(nx, owner);
    assert.equal(await second.get(nx), 'next');
    assert.deepEqual(
      new Set(await Promise.all([first.take(nx), second.take(nx)])),
      new Set(['next', null]),
    );
    assert.equal(await first.replace(nx, 'next', 'resurrected', 10000), false);

    let refreshes = 0;
    const refresh = async () => {
      refreshes += 1;
      await delay(30);
      return {
        accessToken: 'new-access',
        refreshToken: 'rotated-refresh',
        expiresAt: Date.now() + 30000,
      };
    };
    const managerA = new SessionManager(
      first,
      secret,
      namespace,
      policy,
      refresh,
    );
    const managerB = new SessionManager(
      second,
      secret,
      namespace,
      policy,
      refresh,
    );
    const reference = await managerA.create(
      {
        accessToken: 'expired',
        refreshToken: 'old-refresh',
        expiresAt: Date.now() - 1,
      },
      user,
    );
    const sessionKey = key('session:' + reference.split('.')[0]);
    keys.add(sessionKey + ':lock');
    const tokens = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        (index % 2 ? managerA : managerB).access(reference),
      ),
    );
    assert.deepEqual(new Set(tokens), new Set(['new-access']));
    assert.equal(refreshes, 1);
    assert.equal(
      (await managerA.read(reference))?.refreshToken,
      'rotated-refresh',
    );
    const stored = await first.get(sessionKey);
    assert.ok(stored);
    assert.doesNotMatch(stored, /new-access|rotated-refresh/);
    await managerB.logout(reference);
    assert.equal(await managerA.access(reference), null);
  } finally {
    try {
      for (const value of keys) {
        await first.remove(value);
      }
    } finally {
      await Promise.all([first.close(), second.close()]);
    }
  }
});
