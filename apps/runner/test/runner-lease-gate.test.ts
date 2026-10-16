import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { RunnerLeaseGate } from '../src/runner-lease-gate.js';
import type {
  SandboxIdentity,
  StopEvidence,
} from '../src/sandbox-supervisor.js';

const identity = (): SandboxIdentity => ({
  assignmentId: randomUUID(),
  executionId: randomUUID(),
  attemptId: randomUUID(),
  runnerId: 'runner-one',
  ownerSubject: 'runner-owner',
  bootId: randomUUID(),
  generation: 1,
  epoch: 1,
});

test('ack before the monotonic deadline extends authority for new steps', async () => {
  const grant = identity();
  let now = 0;
  let stops = 0;
  const gate = new RunnerLeaseGate(
    grant,
    0,
    {
      async stop() {
        stops++;
        return { state: 'TERMINATED', method: 'GRACEFUL' } as StopEvidence;
      },
    },
    { async renew() {} },
    { nowMs: () => now },
    { leaseTtlMs: 15, renewTimeoutMs: 10 },
  );
  now = 5;
  assert.equal(await gate.renew(), true);
  now = 16;
  assert.equal(gate.canStartStep(), true);
  now = 21;
  assert.equal(gate.canStartStep(), false);
  assert.equal(gate.canStartStep(), false);
  assert.deepEqual(await gate.stopEvidence(), {
    state: 'TERMINATED',
    method: 'GRACEFUL',
  });
  assert.equal(stops, 1);
});

test('renew failure closes the gate before cleanup completes', async () => {
  let finishStop!: (evidence: StopEvidence) => void;
  const stopped = new Promise<StopEvidence>((resolve) => {
    finishStop = resolve;
  });
  let stops = 0;
  const gate = new RunnerLeaseGate(
    identity(),
    0,
    {
      stop() {
        stops++;
        return stopped;
      },
    },
    {
      async renew() {
        throw new Error('coordination unavailable');
      },
    },
    { nowMs: () => 0 },
    { leaseTtlMs: 15, renewTimeoutMs: 10 },
  );
  assert.equal(await gate.renew(), false);
  assert.equal(gate.canStartStep(), false);
  assert.equal(stops, 1);
  finishStop({ state: 'UNCONFIRMED', method: null });
  assert.deepEqual(await gate.stopEvidence(), {
    state: 'UNCONFIRMED',
    method: null,
  });
});

test('hung renewal times out and a late success cannot revive the lease', async () => {
  let acknowledge!: () => void;
  const pending = new Promise<void>((resolve) => {
    acknowledge = resolve;
  });
  let renewals = 0;
  let stops = 0;
  const gate = new RunnerLeaseGate(
    identity(),
    0,
    {
      async stop() {
        stops++;
        return { state: 'UNCONFIRMED', method: null } as StopEvidence;
      },
    },
    {
      async renew() {
        renewals++;
        return pending;
      },
    },
    { nowMs: () => 0 },
    { leaseTtlMs: 15, renewTimeoutMs: 10 },
  );
  const first = gate.renew();
  assert.equal(gate.renew(), first);
  assert.equal(await first, false);
  acknowledge();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(gate.canStartStep(), false);
  assert.equal(await gate.renew(), false);
  assert.equal(renewals, 1);
  assert.equal(stops, 1);
});

test('ack arriving after the old deadline cannot extend authority', async () => {
  let now = 0;
  let acknowledge!: () => void;
  const pending = new Promise<void>((resolve) => {
    acknowledge = resolve;
  });
  let stops = 0;
  const gate = new RunnerLeaseGate(
    identity(),
    0,
    {
      async stop() {
        stops++;
        return { state: 'UNCONFIRMED', method: null } as StopEvidence;
      },
    },
    { renew: () => pending },
    { nowMs: () => now },
    { leaseTtlMs: 15, renewTimeoutMs: 30 },
  );
  const renewing = gate.renew();
  now = 16;
  acknowledge();
  assert.equal(await renewing, false);
  assert.equal(gate.canStartStep(), false);
  assert.equal(stops, 1);
});

test('a second renew call notices expiry while the first call hangs', async () => {
  let now = 0;
  let acknowledge!: () => void;
  const pending = new Promise<void>((resolve) => {
    acknowledge = resolve;
  });
  let stops = 0;
  const gate = new RunnerLeaseGate(
    identity(),
    0,
    {
      async stop() {
        stops++;
        return { state: 'UNCONFIRMED', method: null } as StopEvidence;
      },
    },
    { renew: () => pending },
    { nowMs: () => now },
    { leaseTtlMs: 15, renewTimeoutMs: 30 },
  );
  const first = gate.renew();
  now = 16;
  const expired = gate.renew();
  assert.notEqual(expired, first);
  assert.equal(await expired, false);
  assert.equal(stops, 1);
  acknowledge();
  assert.equal(await first, false);
  assert.equal(gate.canStartStep(), false);
});

test('a regressing clock closes the gate instead of extending authority', async () => {
  let now = 0;
  let stops = 0;
  const gate = new RunnerLeaseGate(
    identity(),
    0,
    {
      async stop() {
        stops++;
        return { state: 'UNCONFIRMED', method: null } as StopEvidence;
      },
    },
    { async renew() {} },
    { nowMs: () => now },
    { leaseTtlMs: 15, renewTimeoutMs: 10 },
  );
  now = 5;
  assert.equal(gate.canStartStep(), true);
  now = 4;
  assert.equal(gate.canStartStep(), false);
  assert.equal(await gate.renew(), false);
  assert.equal(stops, 1);
});

test('initial activation latency is deducted from the local lease deadline', async () => {
  let now = 4;
  let stops = 0;
  const gate = new RunnerLeaseGate(
    identity(),
    0,
    {
      async stop() {
        stops++;
        return { state: 'UNCONFIRMED', method: null } as StopEvidence;
      },
    },
    { async renew() {} },
    { nowMs: () => now },
    { leaseTtlMs: 15, renewTimeoutMs: 10 },
  );
  now = 14;
  assert.equal(gate.canStartStep(), true);
  now = 15;
  assert.equal(gate.canStartStep(), false);
  assert.equal(stops, 1);
});

test('renewal response latency is deducted from the next lease deadline', async () => {
  let now = 0;
  let renewEntered!: () => void;
  const entered = new Promise<void>((resolve) => {
    renewEntered = resolve;
  });
  let acknowledge!: () => void;
  const pending = new Promise<void>((resolve) => {
    acknowledge = resolve;
  });
  let stops = 0;
  const gate = new RunnerLeaseGate(
    identity(),
    0,
    {
      async stop() {
        stops++;
        return { state: 'UNCONFIRMED', method: null } as StopEvidence;
      },
    },
    {
      renew() {
        renewEntered();
        return pending;
      },
    },
    { nowMs: () => now },
    { leaseTtlMs: 15, renewTimeoutMs: 30 },
  );
  now = 5;
  const renewing = gate.renew();
  await entered;
  now = 10;
  acknowledge();
  assert.equal(await renewing, true);
  now = 19;
  assert.equal(gate.canStartStep(), true);
  now = 20;
  assert.equal(gate.canStartStep(), false);
  assert.equal(stops, 1);
});

test('an initial activation response after its local deadline is rejected', () => {
  assert.throws(
    () =>
      new RunnerLeaseGate(
        identity(),
        0,
        {
          async stop() {
            return { state: 'UNCONFIRMED', method: null };
          },
        },
        { async renew() {} },
        { nowMs: () => 15 },
        { leaseTtlMs: 15, renewTimeoutMs: 10 },
      ),
    /activation deadline/i,
  );
});
