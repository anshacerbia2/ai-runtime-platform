import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { RunnerLeaseProof } from '../../src/modules/control-plane/application/runner-lease-store.port.js';
import { InMemoryRunnerLeaseStore } from '../../src/modules/control-plane/infrastructure/in-memory-runner-lease.store.js';
import { RunnerLeaseRecoveryService } from '../../src/modules/control-plane/application/runner-lease-recovery.service.js';
import type { RunnerLeaseRecovery } from '../../src/modules/control-plane/application/runner-lease-recovery.port.js';

const proof: RunnerLeaseProof = {
  assignmentId: '00000000-0000-4000-8000-000000000101',
  executionId: '00000000-0000-4000-8000-000000000102',
  attemptId: '00000000-0000-4000-8000-000000000103',
  runnerId: 'local:runner-node_104',
  ownerSubject: 'runner:test-owner',
  generation: 3,
  epoch: 2,
  nonce: 'abcdefghijklmnopqrstuvwxyzABCDEF',
};

test('lease renewal requires the exact owner, generation, epoch, and nonce', async () => {
  let now = 1_000;
  const store = new InMemoryRunnerLeaseStore(() => now);
  assert.equal(await store.install(proof, 15_000), 'INSTALLED');
  assert.equal(await store.install(proof, 15_000), 'REFRESHED');
  const durable = {
    ...proof,
    nonceDigest: createHash('sha256').update(proof.nonce).digest('hex'),
  };
  assert.equal(await store.inspectDurable(durable), 'CURRENT');
  assert.equal(
    await store.inspectDurable({ ...durable, nonceDigest: '0'.repeat(64) }),
    'MISMATCH',
  );
  assert.equal(
    await store.inspectDurable({
      ...durable,
      generation: proof.generation + 1,
    }),
    'MISMATCH',
  );

  for (const changed of [
    { ...proof, ownerSubject: 'runner:other' },
    { ...proof, generation: proof.generation + 1 },
    { ...proof, epoch: proof.epoch + 1 },
    { ...proof, nonce: '0123456789abcdefghijklmnopqrstuv' },
  ]) {
    assert.equal(await store.inspect(changed), 'MISMATCH');
    assert.equal(await store.renew(changed, 15_000), 'MISMATCH');
    assert.equal(await store.release(changed), 'MISMATCH');
  }

  now += 10_000;
  assert.equal(await store.renew(proof, 15_000), 'RENEWED');
  now += 14_999;
  assert.equal(await store.inspect(proof), 'CURRENT');
  assert.equal(await store.release(proof), 'RELEASED');
  assert.equal(await store.inspect(proof), 'MISSING');
  assert.equal(await store.inspectDurable(durable), 'MISSING');
});

test('renewal never recreates an expired or missing lease', async () => {
  let now = 10_000;
  const store = new InMemoryRunnerLeaseStore(() => now);
  assert.equal(await store.renew(proof, 5_000), 'MISSING');
  assert.equal(await store.inspect(proof), 'MISSING');

  assert.equal(await store.install(proof, 5_000), 'INSTALLED');
  now += 5_000;
  assert.equal(await store.renew(proof, 5_000), 'MISSING');
  assert.equal(await store.inspect(proof), 'MISSING');
});

test('lease input bounds reject weak nonces and unsafe TTLs', async () => {
  const store = new InMemoryRunnerLeaseStore();
  await assert.rejects(
    store.install({ ...proof, nonce: 'short' }, 15_000),
    /nonce must be 32-128 base64url characters/,
  );
  await assert.rejects(
    store.install(proof, 4_999),
    /TTL must be an integer between 5000 and 60000 milliseconds/,
  );
  await assert.rejects(
    store.install(proof, 60_001),
    /TTL must be an integer between 5000 and 60000 milliseconds/,
  );
});

test('recovery suspends stale unactivated grants and retries failed lease inspection', async () => {
  const candidate = {
    assignmentId: proof.assignmentId,
    executionId: proof.executionId,
    proof: {
      ...proof,
      nonceDigest: createHash('sha256').update(proof.nonce).digest('hex'),
    },
  };
  const cursors: Array<string | null> = [];
  const fenced: string[] = [];
  const repository: RunnerLeaseRecovery = {
    async scan(afterId) {
      cursors.push(afterId);
      return [candidate];
    },
    async scanActive() {
      return [candidate];
    },
    async fence(_candidate, reason) {
      fenced.push(reason);
      return true;
    },
  };
  const store = new InMemoryRunnerLeaseStore();
  const recovery = new RunnerLeaseRecoveryService(repository, store);
  const original = store.inspectDurable.bind(store);
  store.inspectDurable = async () => {
    throw new Error('Redis unavailable');
  };
  await assert.rejects(recovery.recover(), /Redis unavailable/);
  store.inspectDurable = original;
  assert.equal(await recovery.recover(), 1);
  assert.deepEqual(cursors, [null, null]);
  assert.deepEqual(fenced, ['LEASE_MISSING']);

  const unactivated: RunnerLeaseRecovery = {
    async scan() {
      return [{ ...candidate, proof: null }];
    },
    async scanActive() {
      return [{ ...candidate, proof: null }];
    },
    async fence(_candidate, reason) {
      fenced.push(reason);
      return true;
    },
  };
  assert.equal(
    await new RunnerLeaseRecoveryService(unactivated, store).recover(),
    1,
  );
  assert.deepEqual(fenced, ['LEASE_MISSING', 'ACTIVATION_TIMEOUT']);
});
