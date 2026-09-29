import { randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from 'redis';
import { loadConfig } from '../src/infrastructure/config/environment-config.js';
import type { RunnerLeaseProof } from '../src/modules/control-plane/application/runner-lease-store.port.js';
import { RedisRunnerLeaseStore } from '../src/modules/control-plane/infrastructure/redis-runner-lease.store.js';
import { RedisRunnerPresenceStore } from '../src/modules/control-plane/infrastructure/redis-runner-presence.store.js';
import { runnerPresenceKey } from '../src/modules/control-plane/infrastructure/runner-presence-proof.js';

const url = loadConfig().runner.coordinationRedisUrl;
if (!url) {
  throw new Error(
    'Set M3_COORDINATION_REDIS_URL to run the real Redis runner lease test.',
  );
}

function leaseProof(): RunnerLeaseProof {
  return {
    assignmentId: randomUUID(),
    executionId: randomUUID(),
    attemptId: randomUUID(),
    runnerId: `runner:${randomUUID()}`,
    ownerSubject: `runner:${randomUUID()}`,
    generation: 7,
    epoch: 4,
    nonce: randomBytes(32).toString('base64url'),
  };
}

test('separate coordinators enforce exact renewal and never recreate a missing lease', async () => {
  const owner = await RedisRunnerLeaseStore.connect(url);
  const peer = await RedisRunnerLeaseStore.connect(url);
  const admin = createClient({ url });
  const proof = leaseProof();
  const key = `ai-runtime:m3:lease:${proof.executionId}`;
  try {
    await admin.connect();
    assert.equal(await owner.install(proof, 15_000), 'INSTALLED');
    assert.equal(await peer.inspect(proof), 'CURRENT');
    assert.equal(await peer.install(proof, 15_000), 'REFRESHED');

    for (const changed of [
      { ...proof, ownerSubject: `runner:${randomUUID()}` },
      { ...proof, generation: proof.generation + 1 },
      { ...proof, epoch: proof.epoch + 1 },
      { ...proof, nonce: randomBytes(32).toString('base64url') },
    ]) {
      assert.equal(await peer.renew(changed, 15_000), 'MISMATCH');
      assert.equal(await peer.release(changed), 'MISMATCH');
      assert.equal(await admin.exists(key), 1);
    }

    assert.equal(await peer.renew(proof, 15_000), 'RENEWED');
    assert.ok((await admin.pTTL(key)) > 0);

    await admin.del(key);
    assert.equal(await owner.renew(proof, 15_000), 'MISSING');
    assert.equal(await admin.exists(key), 0);
    assert.equal(await peer.inspect(proof), 'MISSING');

    assert.equal(await owner.install(proof, 15_000), 'INSTALLED');
    assert.equal(await peer.release(proof), 'RELEASED');
    assert.equal(await admin.exists(key), 0);
  } finally {
    await Promise.allSettled([
      admin.isOpen ? admin.del(key) : Promise.resolve(),
    ]);
    await Promise.allSettled([
      owner.onModuleDestroy(),
      peer.onModuleDestroy(),
      admin.isOpen ? admin.close() : Promise.resolve(),
    ]);
  }
});

test('runner presence is shared and registration-fenced across coordinators', async () => {
  const owner = await RedisRunnerPresenceStore.connect(url);
  const peer = await RedisRunnerPresenceStore.connect(url);
  const admin = createClient({ url });
  const registration = {
    runnerId: `runner:${randomUUID()}`,
    ownerSubject: `runner:${randomUUID()}`,
    registrationRevision: 9,
  };
  const proof = { ...registration, bootId: randomUUID() };
  const prefix = 'ai-runtime:m3:runner-presence';
  const key = runnerPresenceKey(prefix, registration);
  try {
    await admin.connect();
    await owner.heartbeat(proof, 15_000);
    assert.equal(await peer.inspect(registration), 'CURRENT');
    assert.equal(await peer.inspect(proof), 'CURRENT');
    assert.equal(
      await peer.inspect({ ...proof, bootId: randomUUID() }),
      'MISMATCH',
    );
    assert.equal(
      await peer.inspect({ ...registration, registrationRevision: 10 }),
      'MISMATCH',
    );
    assert.equal(
      await peer.inspect({ ...registration, ownerSubject: 'runner:other' }),
      'MISMATCH',
    );
    assert.ok((await admin.pTTL(key)) > 0);
    await admin.del(key);
    assert.equal(await owner.inspect(registration), 'MISSING');
  } finally {
    await Promise.allSettled([
      admin.isOpen ? admin.del(key) : Promise.resolve(),
    ]);
    await Promise.allSettled([
      owner.onModuleDestroy(),
      peer.onModuleDestroy(),
      admin.isOpen ? admin.close() : Promise.resolve(),
    ]);
  }
});
