import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { RunnerLeaseGate } from '../src/runner-lease-gate.js';
import {
  RunnerLeaseLoop,
  type LeaseTimerPort,
} from '../src/runner-lease-loop.js';
import type {
  SandboxIdentity,
  StopEvidence,
} from '../src/sandbox-supervisor.js';

class FakeTimers implements LeaseTimerPort {
  now = 0;
  private nextId = 1;
  private readonly tasks = new Map<
    number,
    { at: number; callback: () => void }
  >();

  schedule(callback: () => void, delayMs: number): number {
    const id = this.nextId++;
    this.tasks.set(id, { at: this.now + delayMs, callback });
    return id;
  }

  cancel(handle: unknown): void {
    this.tasks.delete(handle as number);
  }

  advanceTo(now: number): void {
    this.now = now;
    for (let fired = 0; fired < 20; fired++) {
      const next = [...this.tasks.entries()]
        .filter(([, task]) => task.at <= now)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) {
        return;
      }
      this.tasks.delete(next[0]);
      next[1].callback();
    }
    throw new Error('Timer loop did not settle.');
  }

  get pending(): number {
    return this.tasks.size;
  }
}

function identity(): SandboxIdentity {
  return {
    assignmentId: randomUUID(),
    executionId: randomUUID(),
    attemptId: randomUUID(),
    runnerId: 'runner-one',
    ownerSubject: 'runner-owner',
    bootId: randomUUID(),
    generation: 1,
    epoch: 1,
  };
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

test('loop renews from activation send time and rearms expiry watchdog', async () => {
  const timers = new FakeTimers();
  timers.now = 8;
  let renewals = 0;
  let stops = 0;
  const gate = new RunnerLeaseGate(
    identity(),
    0,
    {
      async stop() {
        stops++;
        return { state: 'TERMINATED', method: 'OBSERVED' } as StopEvidence;
      },
    },
    {
      async renew() {
        renewals++;
      },
    },
    { nowMs: () => timers.now },
    { leaseTtlMs: 15, renewTimeoutMs: 10 },
  );
  const loop = new RunnerLeaseLoop(gate, 5, timers);
  assert.equal(loop.start(), true);
  timers.advanceTo(8);
  await flush();
  assert.equal(renewals, 1);
  timers.advanceTo(13);
  await flush();
  assert.equal(renewals, 2);
  timers.advanceTo(15);
  assert.equal(gate.canStartStep(), true);
  assert.equal(stops, 0);
  await loop.stop();
  assert.equal(stops, 1);
  assert.equal(timers.pending, 0);
});

test('failed renewal closes the gate and cancels both timers', async () => {
  const timers = new FakeTimers();
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
        throw new Error('lease lost');
      },
    },
    { nowMs: () => timers.now },
    { leaseTtlMs: 15, renewTimeoutMs: 10 },
  );
  const loop = new RunnerLeaseLoop(gate, 5, timers);
  assert.equal(loop.start(), true);
  timers.advanceTo(5);
  await flush();
  assert.equal(gate.canStartStep(), false);
  assert.equal(stops, 1);
  assert.equal(timers.pending, 0);
});

test('watchdog stops a sandbox if renewal was never scheduled in time', async () => {
  const timers = new FakeTimers();
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
    { nowMs: () => timers.now },
    { leaseTtlMs: 15, renewTimeoutMs: 10 },
  );
  const loop = new RunnerLeaseLoop(gate, 20, timers);
  assert.equal(loop.start(), true);
  timers.advanceTo(15);
  assert.equal(gate.canStartStep(), false);
  assert.equal(stops, 1);
  assert.equal(timers.pending, 0);
});

test('explicit stop while renewal is pending cannot schedule another renewal', async () => {
  const timers = new FakeTimers();
  let acknowledge!: () => void;
  const pending = new Promise<void>((resolve) => {
    acknowledge = resolve;
  });
  let stops = 0;
  let renewals = 0;
  const gate = new RunnerLeaseGate(
    identity(),
    0,
    {
      async stop() {
        stops++;
        return { state: 'TERMINATED', method: 'GRACEFUL' } as StopEvidence;
      },
    },
    {
      renew() {
        renewals++;
        return pending;
      },
    },
    { nowMs: () => timers.now },
    { leaseTtlMs: 15, renewTimeoutMs: 10 },
  );
  const loop = new RunnerLeaseLoop(gate, 5, timers);
  assert.equal(loop.start(), true);
  timers.advanceTo(5);
  await flush();
  assert.equal(renewals, 1);
  await loop.stop();
  acknowledge();
  await flush();
  timers.advanceTo(100);
  assert.equal(gate.canStartStep(), false);
  assert.equal(stops, 1);
  assert.equal(renewals, 1);
  assert.equal(timers.pending, 0);
});

test('a delayed event loop cannot renew an expired lease', async () => {
  const timers = new FakeTimers();
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
      },
    },
    { nowMs: () => timers.now },
    { leaseTtlMs: 15, renewTimeoutMs: 10 },
  );
  const loop = new RunnerLeaseLoop(gate, 5, timers);
  assert.equal(loop.start(), true);
  timers.advanceTo(16);
  await flush();
  assert.equal(renewals, 0);
  assert.equal(stops, 1);
  assert.equal(gate.canStartStep(), false);
  assert.equal(timers.pending, 0);
});

test('timer registration failure closes the gate before start returns', async () => {
  const timers = new FakeTimers();
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
    { nowMs: () => timers.now },
    { leaseTtlMs: 15, renewTimeoutMs: 10 },
  );
  let registrations = 0;
  const brokenTimers: LeaseTimerPort = {
    schedule(callback, delayMs) {
      if (++registrations === 2) {
        throw new Error('timer unavailable');
      }
      return timers.schedule(callback, delayMs);
    },
    cancel: (handle) => timers.cancel(handle),
  };
  const loop = new RunnerLeaseLoop(gate, 5, brokenTimers);
  assert.equal(loop.start(), false);
  assert.equal(gate.canStartStep(), false);
  assert.equal(stops, 1);
  assert.equal(timers.pending, 0);
});

test('external lease fence cannot leave a running loop or restart it', async () => {
  const timers = new FakeTimers();
  let renewals = 0;
  const gate = new RunnerLeaseGate(
    identity(),
    0,
    {
      async stop() {
        return { state: 'UNCONFIRMED', method: null } as StopEvidence;
      },
    },
    {
      async renew() {
        renewals++;
      },
    },
    { nowMs: () => timers.now },
    { leaseTtlMs: 15, renewTimeoutMs: 10 },
  );
  const loop = new RunnerLeaseLoop(gate, 5, timers);
  assert.equal(loop.start(), true);
  await gate.stop();
  assert.equal(loop.start(), false);
  assert.equal(timers.pending, 0);
  timers.advanceTo(100);
  assert.equal(renewals, 0);
});
