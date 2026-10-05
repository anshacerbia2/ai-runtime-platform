import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import {
  LocalSandboxSupervisor,
  type SandboxHandle,
  type SandboxIdentity,
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

test('duplicate start shares one exact sandbox launch and stop is idempotent', async () => {
  const grant = identity();
  let launches = 0;
  let graceful = 0;
  let inspected = 0;
  const handle: SandboxHandle = {
    async requestStop() {
      graceful++;
    },
    async forceStop() {
      throw new Error('force must not run');
    },
    async inspect() {
      inspected++;
      return 'EXITED';
    },
  };
  const supervisor = new LocalSandboxSupervisor({
    async launch() {
      launches++;
      return handle;
    },
  });
  const [first, replay] = await Promise.all([
    supervisor.start(grant),
    supervisor.start({ ...grant }),
  ]);
  assert.equal(first, handle);
  assert.equal(replay, handle);
  assert.equal(launches, 1);
  const [stopped, repeat] = await Promise.all([
    supervisor.stop(grant),
    supervisor.stop({ ...grant }),
  ]);
  assert.deepEqual(stopped, { state: 'TERMINATED', method: 'GRACEFUL' });
  assert.deepEqual(repeat, stopped);
  assert.equal(graceful, 1);
  assert.equal(inspected, 1);
  assert.throws(() => supervisor.start(grant), /stopp?ed/i);
});

test('stop waits for in-flight launch then escalates and requires exit inspection', async () => {
  const grant = identity();
  let completeLaunch!: (handle: SandboxHandle) => void;
  const pending = new Promise<SandboxHandle>((resolve) => {
    completeLaunch = resolve;
  });
  const calls: string[] = [];
  const handle: SandboxHandle = {
    async requestStop() {
      calls.push('graceful');
    },
    async forceStop() {
      calls.push('force');
    },
    async inspect() {
      calls.push('inspect');
      return calls.includes('force') ? 'EXITED' : 'RUNNING';
    },
  };
  const supervisor = new LocalSandboxSupervisor({
    async launch() {
      return pending;
    },
  });
  const started = supervisor.start(grant);
  const stopping = supervisor.stop(grant);
  completeLaunch(handle);
  await assert.rejects(started, /stopp?ed/i);
  assert.deepEqual(await stopping, {
    state: 'TERMINATED',
    method: 'FORCED',
  });
  assert.deepEqual(calls, ['graceful', 'inspect', 'force', 'inspect']);
});

test('unknown sandbox or failed inspection never becomes termination evidence', async () => {
  const grant = identity();
  const supervisor = new LocalSandboxSupervisor({
    async launch() {
      return {
        async requestStop() {
          throw new Error('signal failed');
        },
        async forceStop() {
          throw new Error('force failed');
        },
        async inspect() {
          throw new Error('host unavailable');
        },
      } satisfies SandboxHandle;
    },
  });
  await supervisor.start(grant);
  assert.deepEqual(await supervisor.stop(grant), {
    state: 'UNCONFIRMED',
    method: null,
  });
  assert.deepEqual(await supervisor.stop(identity()), {
    state: 'UNCONFIRMED',
    method: null,
  });
});

test('observed exit is evidence even when the stop signal fails', async () => {
  const grant = identity();
  const supervisor = new LocalSandboxSupervisor({
    async launch() {
      return {
        async requestStop() {
          throw new Error('signal failed');
        },
        async forceStop() {
          throw new Error('force must not run');
        },
        async inspect() {
          return 'EXITED';
        },
      } satisfies SandboxHandle;
    },
  });
  await supervisor.start(grant);
  assert.deepEqual(await supervisor.stop(grant), {
    state: 'TERMINATED',
    method: 'OBSERVED',
  });
});

test('stale generation or boot cannot stop another sandbox', async () => {
  const grant = identity();
  let signals = 0;
  const supervisor = new LocalSandboxSupervisor({
    async launch() {
      return {
        async requestStop() {
          signals++;
        },
        async forceStop() {
          signals++;
        },
        async inspect() {
          return 'EXITED';
        },
      } satisfies SandboxHandle;
    },
  });
  await supervisor.start(grant);
  assert.throws(
    () => supervisor.stop({ ...grant, generation: 2 }),
    /identity/i,
  );
  assert.throws(
    () => supervisor.stop({ ...grant, bootId: randomUUID() }),
    /identity/i,
  );
  assert.throws(
    () => supervisor.stop({ ...grant, ownerSubject: 'other' }),
    /identity/i,
  );
  assert.equal(signals, 0);
});

test('late launch after stop deadline remains unconfirmed and receives cleanup', async () => {
  const grant = identity();
  let completeLaunch!: (handle: SandboxHandle) => void;
  const pending = new Promise<SandboxHandle>((resolve) => {
    completeLaunch = resolve;
  });
  let signals = 0;
  const supervisor = new LocalSandboxSupervisor(
    {
      async launch() {
        return pending;
      },
    },
    { launchMs: 10, gracefulMs: 10, forceMs: 10 },
  );
  const started = supervisor.start(grant);
  assert.deepEqual(await supervisor.stop(grant), {
    state: 'UNCONFIRMED',
    method: null,
  });
  completeLaunch({
    async requestStop() {
      signals++;
    },
    async forceStop() {
      signals++;
    },
    async inspect() {
      return 'EXITED';
    },
  });
  await assert.rejects(started, /stopp?ed/i);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(signals, 1);
  assert.deepEqual(await supervisor.stop(grant), {
    state: 'UNCONFIRMED',
    method: null,
  });
  assert.throws(() => supervisor.start(grant), /stopp?ed/i);
});

test('hung stop and inspection are bounded and cannot certify termination', async () => {
  const grant = identity();
  let forced = 0;
  const never = new Promise<void>(() => {});
  const supervisor = new LocalSandboxSupervisor(
    {
      async launch() {
        return {
          requestStop: () => never,
          async forceStop() {
            forced++;
          },
          async inspect() {
            return 'UNKNOWN';
          },
        } satisfies SandboxHandle;
      },
    },
    { launchMs: 10, gracefulMs: 10, forceMs: 10 },
  );
  await supervisor.start(grant);
  assert.deepEqual(await supervisor.stop(grant), {
    state: 'UNCONFIRMED',
    method: null,
  });
  assert.equal(forced, 1);
});

test('stop before launch seals the assignment but cannot assert a process exit', async () => {
  const grant = identity();
  let launches = 0;
  const supervisor = new LocalSandboxSupervisor({
    async launch() {
      launches++;
      throw new Error('must not launch');
    },
  });
  assert.deepEqual(await supervisor.stop(grant), {
    state: 'UNCONFIRMED',
    method: null,
  });
  assert.throws(() => supervisor.start(grant), /stopp?ed/i);
  assert.equal(launches, 0);
  assert.throws(() => supervisor.stop({ ...grant, epoch: 2 }), /identity/i);
});
