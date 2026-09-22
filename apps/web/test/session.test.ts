import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { fixtureSessions, user } from './fixtures';

test('G37 cookie is an opaque signed reference; credentials exist only encrypted in the server store', async () => {
  const { store, manager } = fixtureSessions();
  const ref = await manager.create(
    {
      accessToken: 'sensitive-access',
      refreshToken: 'sensitive-refresh',
      expiresAt: Date.now() + 10000,
    },
    user,
  );
  assert.match(ref, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.equal(ref.includes('sensitive'), false);
  assert.equal(
    JSON.stringify([...store.entries.values()]).includes('sensitive'),
    false,
  );
  assert.equal(await manager.access(ref), 'sensitive-access');
  assert.equal(await manager.read('x' + ref.slice(1)), null);
  await manager.logout(ref);
  assert.equal(await manager.read(ref), null);
});

test('G36 login state is signed, time-bounded, and consumed only once', async () => {
  const { manager } = fixtureSessions();
  const ref = await manager.login({
    state: 'state',
    nonce: 'nonce',
    verifier: 'verifier',
    returnTo: '/control-plane',
  });
  assert.equal((await manager.consumeLogin(ref))?.state, 'state');
  assert.equal(await manager.consumeLogin(ref), null);
  assert.equal(await manager.consumeLogin('tampered'), null);
});

test('G37 parallel expiry produces one refresh and one rotated refresh token', async () => {
  let calls = 0;
  const { manager } = fixtureSessions(async () => {
    calls++;
    await delay(20);
    return {
      accessToken: 'new-access',
      refreshToken: 'rotated',
      expiresAt: Date.now() + 10000,
    };
  });
  const ref = await manager.create(
    {
      accessToken: 'expired',
      refreshToken: 'old-refresh',
      expiresAt: Date.now() - 1000,
    },
    user,
  );
  const values = await Promise.all(
    Array.from({ length: 20 }, () => manager.access(ref)),
  );
  assert.deepEqual(new Set(values), new Set(['new-access']));
  assert.equal(calls, 1);
  assert.equal((await manager.read(ref))?.refreshToken, 'rotated');
});

test('G37 logout while refresh is in flight cannot resurrect a session', async () => {
  let release!: () => void;
  let started!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  const { manager } = fixtureSessions(async () => {
    started();
    await blocked;
    return { accessToken: 'late-access', expiresAt: Date.now() + 10000 };
  });
  const ref = await manager.create(
    { accessToken: 'old', refreshToken: 'refresh', expiresAt: 1 },
    user,
  );
  const pending = manager.access(ref);
  await entered;
  await manager.logout(ref);
  release();
  assert.equal(await pending, null);
  assert.equal(await manager.read(ref), null);
});

test('G37 rejected refresh invalidates local session instead of returning an expired token', async () => {
  const { manager } = fixtureSessions();
  const ref = await manager.create(
    { accessToken: 'expired', refreshToken: 'revoked', expiresAt: 1 },
    user,
  );
  assert.equal(await manager.access(ref), null);
  assert.equal(await manager.read(ref), null);
});
