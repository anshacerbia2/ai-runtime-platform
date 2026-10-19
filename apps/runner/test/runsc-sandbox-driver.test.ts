import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import {
  RunscSandboxDriver,
  runscBindingAnnotation,
  runscSandboxId,
  type RunscLaunchRecord,
  type RunscSandboxHost,
} from '../src/runsc-sandbox-driver.js';
import {
  LocalSandboxSupervisor,
  type SandboxIdentity,
} from '../src/sandbox-supervisor.js';

const identity = (): SandboxIdentity => ({
  assignmentId: randomUUID(),
  executionId: randomUUID(),
  attemptId: randomUUID(),
  runnerId: 'runner',
  ownerSubject: 'owner',
  bootId: randomUUID(),
  generation: 1,
  epoch: 1,
});
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

function fixture() {
  const records = new Map<string, RunscLaunchRecord>();
  let state: string | null = 'running';
  let foreign = false;
  let empty = false;
  let broken = false;
  let starts = 0;
  let destroys = 0;
  let signals = 0;
  let finish!: (result: 'REAPED' | 'LOST') => void;
  const finished = new Promise<'REAPED' | 'LOST'>((resolve) => {
    finish = resolve;
  });
  const host: RunscSandboxHost = {
    async reserve(binding, id) {
      const existing = records.get(id);
      if (existing) {
        return { record: existing, fresh: false };
      }
      const record = {
        identity: { ...binding },
        sandboxId: id,
        bundle: `/private/${id}`,
      };
      records.set(id, record);
      return { record, fresh: true };
    },
    async lookup(id) {
      return records.get(id) ?? null;
    },
    start(record) {
      assert.deepEqual(
        records.get(record.sandboxId),
        record,
        'reservation precedes spawn',
      );
      starts++;
      return { ready: Promise.resolve(), finished };
    },
    async state(record) {
      if (broken) {
        throw new Error('CLI unavailable');
      }
      return state === null
        ? null
        : {
            id: record.sandboxId,
            bundle: record.bundle,
            status: state,
            annotations: {
              [runscBindingAnnotation]: JSON.stringify({
                ...record.identity,
                ...(foreign ? { bootId: 'foreign' } : {}),
              }),
            },
          };
    },
    async signalAll() {
      signals++;
    },
    async destroy() {
      destroys++;
      state = null;
    },
    async cgroupEmpty() {
      return empty;
    },
  };
  return {
    host,
    records,
    finish,
    counts: () => ({ starts, destroys, signals }),
    setState: (value: string | null) => {
      state = value;
    },
    setEmpty: (value: boolean) => {
      empty = value;
    },
    setForeign: () => {
      foreign = true;
    },
    breakObservation: () => {
      broken = true;
    },
  };
}

test('concurrent retries reserve before one spawn, capture identity and retain tombstones', async () => {
  const f = fixture();
  const driver = new RunscSandboxDriver(f.host);
  const binding = identity();
  const captured = { ...binding };
  const first = driver.launch(binding);
  binding.bootId = 'mutated';
  const [handle, duplicate] = await Promise.all([
    first,
    driver.launch(captured),
  ]);
  assert.equal(handle, duplicate);
  assert.equal(f.counts().starts, 1);
  f.setState('stopped');
  f.setEmpty(true);
  assert.equal(await handle.inspect(), 'EXITED');
  assert.equal(await driver.launch(captured), handle);
  assert.equal(f.counts().starts, 1);
  await assert.rejects(driver.launch({ ...captured, epoch: 2 }), /identity/);
});

test('new driver recovers a reserved assignment without another spawn even when absent', async () => {
  const f = fixture();
  const binding = identity();
  await new RunscSandboxDriver(f.host).launch(binding);
  f.setState(null);
  f.setEmpty(true);
  const recovered = new RunscSandboxDriver(f.host);
  const handle = await recovered.launch(binding);
  assert.equal(await handle.inspect(), 'UNKNOWN');
  assert.equal(f.counts().starts, 1);
  assert.equal(
    f.counts().destroys,
    0,
    'absent state does not authorize cleanup proof',
  );
});

test('recovery verifies all identity fields before signaling an existing sandbox', async () => {
  const f = fixture();
  const binding = identity();
  await new RunscSandboxDriver(f.host).launch(binding);
  for (const key of [
    'executionId',
    'attemptId',
    'runnerId',
    'ownerSubject',
    'bootId',
    'generation',
    'epoch',
  ] as const) {
    const wrong = {
      ...binding,
      [key]: typeof binding[key] === 'number' ? 2 : 'foreign',
    };
    await assert.rejects(
      new RunscSandboxDriver(f.host).recover(wrong),
      /identity/,
    );
  }
  const recovered = await new RunscSandboxDriver(f.host).recover(binding);
  assert.deepEqual(recovered?.identity, binding);
  f.setForeign();
  await assert.rejects(recovered!.handle.forceStop(), /binding/);
  assert.equal(await recovered!.handle.inspect(), 'UNKNOWN');
  assert.deepEqual(f.counts(), { starts: 1, destroys: 0, signals: 0 });
});

test('TERM acknowledgement and empty cgroup cannot certify a still-running sandbox', async () => {
  const f = fixture();
  const handle = await new RunscSandboxDriver(f.host).launch(identity());
  f.setEmpty(true);
  await handle.requestStop();
  assert.equal(await handle.inspect(), 'RUNNING');
  assert.equal(f.counts().destroys, 0);
});

test('attached monitor loss plus missing state stays unknown; numeric reaping still needs subtree cleanup', async () => {
  for (const outcome of ['LOST', 'REAPED'] as const) {
    const f = fixture();
    const handle = await new RunscSandboxDriver(f.host).launch(identity());
    f.finish(outcome);
    await tick();
    f.setState(null);
    assert.equal(await handle.inspect(), 'UNKNOWN');
    f.setEmpty(true);
    assert.equal(
      await handle.inspect(),
      outcome === 'REAPED' ? 'EXITED' : 'UNKNOWN',
    );
  }
});

test('recovered live binding can be destroyed and independently inspected without a monitor', async () => {
  const f = fixture();
  const binding = identity();
  await new RunscSandboxDriver(f.host).launch(binding);
  const handle = (await new RunscSandboxDriver(f.host).recover(binding))!
    .handle;
  await handle.forceStop();
  assert.equal(await handle.inspect(), 'UNKNOWN', 'children are still present');
  f.setEmpty(true);
  assert.equal(await handle.inspect(), 'EXITED');
  assert.deepEqual(f.counts(), { starts: 1, signals: 1, destroys: 1 });
});

test('failed runtime observation stays unknown and does not authorize a signal', async () => {
  const f = fixture();
  const handle = await new RunscSandboxDriver(f.host).launch(identity());
  f.breakObservation();
  await assert.rejects(handle.requestStop());
  assert.equal(await handle.inspect(), 'UNKNOWN');
  assert.equal(f.counts().signals, 0);
});

test('matching live observation before disappearance still requires trusted delete and an empty subtree', async () => {
  const f = fixture();
  const binding = identity();
  await new RunscSandboxDriver(f.host).launch(binding);
  const handle = (await new RunscSandboxDriver(f.host).recover(binding))!
    .handle;
  await handle.requestStop();
  f.setState(null);
  assert.equal(await handle.inspect(), 'UNKNOWN');
  f.setEmpty(true);
  assert.equal(await handle.inspect(), 'EXITED');
  assert.equal(f.counts().destroys, 1);
});

test('failed reservation or ambiguous spawn is never retried in the same driver', async () => {
  for (const phase of ['reserve', 'start'] as const) {
    const f = fixture();
    let calls = 0;
    const host = {
      ...f.host,
      [phase]: () => {
        calls++;
        throw new Error('ambiguous failure');
      },
    };
    const driver = new RunscSandboxDriver(host);
    const binding = identity();
    await assert.rejects(driver.launch(binding));
    await assert.rejects(driver.launch(binding));
    assert.equal(calls, 1);
  }
});

test('stop lookup seals a missing assignment against later launch', async () => {
  const f = fixture();
  const driver = new RunscSandboxDriver(f.host);
  const binding = identity();
  assert.equal(await driver.recover(binding), null);
  await assert.rejects(driver.launch(binding), /sealed/);
  assert.equal(f.counts().starts, 0);
});

test('supervisor stop, drain and authority loss during async preparation prevent the actual spawn', async () => {
  for (const mode of ['stop', 'drain', 'authority'] as const) {
    const f = fixture();
    let release!: () => void;
    let entered!: () => void;
    const preparing = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const paused = new Promise<void>((resolve) => {
      release = resolve;
    });
    const reserve = f.host.reserve;
    f.host.reserve = async (...args) => {
      entered();
      await paused;
      return reserve(...args);
    };
    const driver = new RunscSandboxDriver(f.host);
    const supervisor = new LocalSandboxSupervisor(driver);
    const binding = identity();
    let authorized = true;
    const starting = supervisor.start(binding, () => authorized);
    const rejection = assert.rejects(starting, /authority/);
    await preparing;
    let stop: Promise<unknown> | undefined;
    if (mode === 'stop') {
      stop = supervisor.stop(binding);
    }
    if (mode === 'drain') {
      supervisor.quiesce();
    }
    if (mode === 'authority') {
      authorized = false;
    }
    release();
    await rejection;
    await stop;
    assert.equal(f.counts().starts, 0);
    assert.equal(
      f.records.size,
      1,
      'unused reservation is retained, never retried',
    );
  }
});

test('driver lifetime capacity stays bounded even after stop recovery misses', async () => {
  const driver = new RunscSandboxDriver(fixture().host);
  for (let i = 0; i < 256; i++) {
    assert.equal(await driver.recover(identity()), null);
  }
  await assert.rejects(driver.launch(identity()), /capacity/);
});

test('stop during runtime creation waits for observable launch before cleanup', async () => {
  const f = fixture();
  let ready!: () => void;
  let spawned!: () => void;
  const entered = new Promise<void>((resolve) => {
    spawned = resolve;
  });
  const pending = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const start = f.host.start;
  f.host.start = (record) => {
    const monitor = start(record);
    spawned();
    return { ...monitor, ready: pending };
  };
  const supervisor = new LocalSandboxSupervisor(new RunscSandboxDriver(f.host));
  const binding = identity();
  const starting = supervisor.start(binding);
  const rejected = assert.rejects(starting, /stopped/);
  await entered;
  const stopping = supervisor.stop(binding);
  assert.equal(f.counts().signals, 0);
  f.setEmpty(true);
  ready();
  assert.equal((await stopping).state, 'TERMINATED');
  await rejected;
  assert.equal(f.counts().signals, 2);
});

test('deterministic IDs bind assignment and reject malformed identities before host I/O', async () => {
  const f = fixture();
  const driver = new RunscSandboxDriver(f.host);
  const binding = identity();
  assert.match(runscSandboxId(binding), /^airt-runner-[a-f0-9]{64}$/);
  assert.equal(
    runscSandboxId(binding),
    runscSandboxId({ ...binding, bootId: 'other' }),
  );
  for (const wrong of [
    { ...binding, epoch: 0 },
    { ...binding, assignmentId: '' },
    { ...binding, runnerId: 'x'.repeat(257) },
  ]) {
    await assert.rejects(driver.launch(wrong));
  }
  assert.equal(f.records.size, 0);
});
