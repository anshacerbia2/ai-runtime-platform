import test from 'node:test';
import assert from 'node:assert/strict';
import type { RunnerLeaseProof } from '../../src/modules/control-plane/application/runner-lease-store.port.js';
import { InMemoryRunnerLeaseStore } from '../../src/modules/control-plane/infrastructure/in-memory-runner-lease.store.js';

const proof: RunnerLeaseProof = {
  assignmentId: '00000000-0000-4000-8000-000000000101',
  executionId: '00000000-0000-4000-8000-000000000102',
  attemptId: '00000000-0000-4000-8000-000000000103',
  runnerId: '00000000-0000-4000-8000-000000000104',
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
