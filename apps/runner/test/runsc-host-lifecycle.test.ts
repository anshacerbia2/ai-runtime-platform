import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import {
  RunscHostLifecycle,
  type RunscHostPorts,
} from '../src/runsc-host-lifecycle.js';
import { makeRunscReservation } from '../src/file-runsc-launch-store.js';
import {
  runscBindingAnnotation,
  runscSandboxId,
  type RunscLaunchRecord,
} from '../src/runsc-sandbox-driver.js';
import type { SandboxIdentity } from '../src/sandbox-supervisor.js';
import type { RunscProcessExit } from '../src/runsc-process-client.js';

const digest = `sha256:${'a'.repeat(64)}`;
const identity = (): SandboxIdentity => ({
  assignmentId: randomUUID(),
  executionId: 'exec',
  attemptId: 'attempt',
  runnerId: 'runner',
  ownerSubject: 'owner',
  bootId: 'boot',
  generation: 1,
  epoch: 1,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function fixture() {
  const rows = new Map<string, ReturnType<typeof makeRunscReservation>>();
  const states = new Map<string, unknown>();
  const monitors: ReturnType<typeof deferred<RunscProcessExit>>[] = [];
  const events: string[] = [];
  let preparation = Promise.resolve();
  let empty = true;
  let retained: boolean | undefined;
  let guardCheck: (() => void) | undefined;
  const record = (binding: SandboxIdentity) => ({
    identity: binding,
    sandboxId: runscSandboxId(binding),
    bundle: `/private/bundles/${runscSandboxId(binding)}`,
  });
  const receipt = (binding: SandboxIdentity) => ({
    record: record(binding),
    configDigest: digest,
    rootfsDigest: digest,
  });
  const ports: RunscHostPorts = {
    store: {
      recoveryRequired: false,
      async lookup(id) {
        return rows.get(id) ?? null;
      },
      async reserve(value, hash) {
        const saved = makeRunscReservation(value, hash, '/private/bundles');
        const previous = rows.get(value.sandboxId);
        rows.set(value.sandboxId, saved);
        events.push('commit');
        return { reservation: previous ?? saved, fresh: !previous };
      },
      async close(options) {
        retained = options?.retainLock === true;
        events.push(retained ? 'retain' : 'unlock');
      },
    },
    bundles: {
      recoveryRequired: false,
      async prepare(binding) {
        events.push('prepare');
        await preparation;
        return receipt(binding);
      },
      async verify(binding) {
        events.push('verify');
        return receipt(binding);
      },
      async close() {
        events.push('bundles-close');
      },
    },
    runtime: {
      recoveryRequired: false,
      async list() {
        return [...states.keys()].map((id) => ({
          id,
          status: 'running' as const,
        }));
      },
      async readState(value) {
        return states.get(value.sandboxId);
      },
      run(value, guard) {
        guardCheck?.();
        if (guard && !guard.canLaunch()) {
          throw new Error('Denied');
        }
        events.push('run');
        const monitor = deferred<RunscProcessExit>();
        monitors.push(monitor);
        return { finished: monitor.promise };
      },
      async signalAll() {
        events.push('signal');
      },
      async destroy(value) {
        states.delete(value.sandboxId);
        events.push('delete');
      },
      async close() {
        events.push('runtime-close');
      },
    },
    cgroups: {
      recoveryRequired: false,
      async empty() {
        events.push('inspect');
        return empty;
      },
      async close() {
        events.push('cgroups-close');
      },
    },
  };
  const host = new RunscHostLifecycle(ports, {
    bundleRoot: '/private/bundles',
    program: 'agent',
    approvedRootfsDigest: digest,
  });
  const running = (value: RunscLaunchRecord) =>
    states.set(value.sandboxId, {
      id: value.sandboxId,
      bundle: value.bundle,
      status: 'running',
      annotations: { [runscBindingAnnotation]: JSON.stringify(value.identity) },
    });
  return {
    host,
    ports,
    rows,
    states,
    events,
    monitors,
    record,
    running,
    retained: () => retained,
    blockPreparation: (promise: Promise<void>) => {
      preparation = promise;
    },
    setEmpty: (value: boolean) => {
      empty = value;
    },
    onGuard: (callback: () => void) => {
      guardCheck = callback;
    },
  };
}

test('concurrent reservations commit once, freeze identity and grant one synchronous launch', async () => {
  const f = fixture();
  const binding = identity();
  const saved = { ...binding };
  const first = f.host.reserve(binding, runscSandboxId(binding));
  const replay = f.host.reserve(saved, runscSandboxId(saved));
  binding.bootId = 'changed';
  const [a, b] = await Promise.all([first, replay]);
  assert.equal(a.fresh, true);
  assert.equal(b.fresh, false);
  assert.deepEqual(a.record.identity, saved);
  assert.ok(Object.isFrozen(a.record.identity));
  await assert.rejects(
    f.host.reserve({ ...saved, epoch: 2 }, a.record.sandboxId),
  );
  assert.throws(() => f.host.start({ ...a.record, bundle: '/foreign' }));
  const monitor = f.host.start(a.record);
  assert.deepEqual(f.events, ['prepare', 'verify', 'commit', 'run']);
  assert.throws(() => f.host.start(b.record));
  f.monitors[0]!.resolve({ state: 'REAPED', code: 0 });
  await monitor.ready;
  await f.host.close();
  assert.equal(f.retained(), false);
  assert.ok(f.events.indexOf('delete') < f.events.indexOf('unlock'));
  assert.ok(f.events.indexOf('runtime-close') < f.events.indexOf('unlock'));
});

test('close seals starts synchronously, drains accepted preparation and releases only after fresh absence and cgroup inspection', async () => {
  const f = fixture();
  const barrier = deferred<void>();
  f.blockPreparation(barrier.promise);
  const binding = identity();
  const pending = f.host.reserve(binding, runscSandboxId(binding));
  const closing = f.host.close();
  assert.equal(f.host.close(), closing);
  await assert.rejects(f.host.reserve(identity(), runscSandboxId(identity())));
  assert.throws(() => f.host.start(f.record(binding)));
  assert.equal(f.retained(), undefined);
  barrier.resolve();
  const reservation = await pending;
  assert.throws(() => f.host.start(reservation.record));
  await closing;
  assert.equal(f.retained(), false);
  assert.ok(!f.events.includes('run'));
  assert.ok(f.events.indexOf('commit') < f.events.indexOf('unlock'));
});

test('empty cgroup and absent state never unlock while the original creation monitor is pending', async () => {
  const f = fixture();
  const binding = identity();
  const { record } = await f.host.reserve(binding, runscSandboxId(binding));
  const monitor = f.host.start(record);
  const closing = f.host.close();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.retained(), undefined);
  assert.throws(() => f.host.start(record));
  f.monitors[0]!.resolve({ state: 'REAPED', code: 0 });
  await monitor.ready;
  await closing;
  assert.equal(f.retained(), false);
});

test('LOST monitor keeps lock even after independent state absence and empty cgroup; close cannot later downgrade', async () => {
  const f = fixture();
  const binding = identity();
  const { record } = await f.host.reserve(binding, runscSandboxId(binding));
  const monitor = f.host.start(record);
  const rejected = assert.rejects(monitor.ready, /startup unconfirmed/);
  f.monitors[0]!.resolve({ state: 'LOST', code: null });
  assert.equal(await monitor.finished, 'LOST');
  await rejected;
  assert.equal((await f.host.reserve(binding, record.sandboxId)).fresh, false);
  assert.throws(() => f.host.start(record));
  await assert.rejects(f.host.close(), /ownership retained/);
  await assert.rejects(f.host.close(), /ownership retained/);
  assert.equal(f.retained(), true);
  assert.ok(!f.events.includes('unlock'));
});

test('live/foreign state or a populated descendant prevents unlock without signal or deletion', async () => {
  for (const mode of ['live', 'foreign', 'child']) {
    const f = fixture();
    const binding = identity();
    const { record } = await f.host.reserve(binding, runscSandboxId(binding));
    const monitor = f.host.start(record);
    f.running(record);
    await monitor.ready;
    f.monitors[0]!.resolve({ state: 'REAPED', code: 0 });
    await monitor.finished;
    if (mode === 'foreign') {
      f.running({ ...record, identity: { ...binding, bootId: 'foreign' } });
    }
    if (mode === 'child') {
      f.states.clear();
      f.setEmpty(false);
    }
    await assert.rejects(f.host.close(), /ownership retained/);
    assert.equal(f.retained(), true);
    assert.ok(!f.events.includes('signal'));
    if (mode !== 'child') {
      assert.ok(!f.events.includes('delete'));
    }
  }
});

test('final guard is forwarded through synchronous validation and denied attempt never reruns', async () => {
  const f = fixture();
  const binding = identity();
  const { record } = await f.host.reserve(binding, runscSandboxId(binding));
  let allowed = true;
  f.onGuard(() => {
    allowed = false;
  });
  assert.throws(() => f.host.start(record, { canLaunch: () => allowed }));
  assert.throws(() => f.host.start(record));
  assert.ok(!f.events.includes('run'));
  await assert.rejects(f.host.close(), /ownership retained/);
});

test('preparation failure, rootfs receipt substitution, transport error and close error retain ownership', async () => {
  for (const mode of ['prepare', 'digest', 'transport', 'close']) {
    const f = fixture();
    if (mode === 'prepare') {
      f.ports.bundles.prepare = async () => {
        throw new Error('IO');
      };
    }
    if (mode === 'digest') {
      const verify = f.ports.bundles.verify;
      f.ports.bundles.verify = async (a, b) => ({
        ...(await verify(a, b)),
        rootfsDigest: `sha256:${'b'.repeat(64)}`,
      });
    }
    const binding = identity();
    const reservation = f.host.reserve(binding, runscSandboxId(binding));
    if (mode === 'prepare' || mode === 'digest') {
      await assert.rejects(reservation);
    } else {
      await reservation;
    }
    if (mode === 'transport') {
      f.ports.runtime.list = async () => {
        throw new Error('IO');
      };
    }
    if (mode === 'close') {
      f.ports.cgroups.close = async () => {
        throw new Error('IO');
      };
    }
    await assert.rejects(f.host.close(), /ownership retained/);
    assert.equal(f.retained(), true);
    assert.ok(!f.events.includes('unlock'));
  }
});

test('admitted preparation is bounded without evicting a lifetime assignment', async () => {
  const f = fixture();
  const barrier = deferred<void>();
  f.blockPreparation(barrier.promise);
  const pending = Array.from({ length: 8 }, () => {
    const binding = identity();
    return f.host.reserve(binding, runscSandboxId(binding));
  });
  const denied = identity();
  await assert.rejects(
    f.host.reserve(denied, runscSandboxId(denied)),
    /capacity/,
  );
  barrier.resolve();
  await Promise.all(pending);
  await f.host.close();
  assert.equal(f.retained(), false);
});

test('untracked runtime and changed durable binding prevent ownership release', async () => {
  for (const mode of ['untracked', 'metadata']) {
    const f = fixture();
    const binding = identity();
    const { record } = await f.host.reserve(binding, runscSandboxId(binding));
    if (mode === 'untracked') {
      f.states.set('foreign-runtime', {});
    } else {
      f.rows.set(
        record.sandboxId,
        makeRunscReservation(
          { ...record, identity: { ...binding, epoch: 2 } },
          digest,
          '/private/bundles',
        ),
      );
    }
    await assert.rejects(f.host.close(), /ownership retained/);
    assert.equal(f.retained(), true);
    assert.ok(!f.events.includes('delete'));
  }
});

test('shutdown triggered inside the final guard denies the OS spawn and retains ownership', async () => {
  const f = fixture();
  const binding = identity();
  const { record } = await f.host.reserve(binding, runscSandboxId(binding));
  let closing: Promise<void> | undefined;
  assert.throws(() =>
    f.host.start(record, {
      canLaunch: () => {
        closing = f.host.close();
        return true;
      },
    }),
  );
  await assert.rejects(closing!, /ownership retained/);
  assert.ok(!f.events.includes('run'));
});

test('lifetime host capacity never evicts old reservations to admit a new assignment', async () => {
  const f = fixture();
  const first = identity();
  await f.host.reserve(first, runscSandboxId(first));
  for (let i = 1; i < 256; i++) {
    const binding = identity();
    await f.host.reserve(binding, runscSandboxId(binding));
  }
  const excess = identity();
  await assert.rejects(
    f.host.reserve(excess, runscSandboxId(excess)),
    /capacity/,
  );
  assert.equal(
    (await f.host.reserve(first, runscSandboxId(first))).fresh,
    false,
  );
  await f.host.close();
});

test('outer worker uncertainty retains ownership even with no sandbox and cannot be downgraded', async () => {
  const f = fixture();
  const options = { retainLock: true };
  const closing = f.host.close(options);
  options.retainLock = false;
  assert.equal(f.host.close(), closing);
  await assert.rejects(closing, /ownership retained/);
  assert.equal(f.retained(), true);
  assert.ok(!f.events.includes('unlock'));
});
