import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import {
  chmod,
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import {
  FileRunscLaunchStore,
  makeRunscReservation,
} from '../src/file-runsc-launch-store.js';
import {
  RunscSandboxDriver,
  runscSandboxId,
  type RunscLaunchRecord,
} from '../src/runsc-sandbox-driver.js';

const linux = { skip: process.platform !== 'linux' };
const digest = `sha256:${'a'.repeat(64)}`;
function record(bundleRoot = '/private/bundles'): RunscLaunchRecord {
  const identity = {
    assignmentId: randomUUID(),
    executionId: randomUUID(),
    attemptId: randomUUID(),
    runnerId: 'runner',
    ownerSubject: 'owner',
    bootId: randomUUID(),
    generation: 1,
    epoch: 1,
  };
  const sandboxId = runscSandboxId(identity);
  return { identity, sandboxId, bundle: `${bundleRoot}/${sandboxId}` };
}
async function fixture(t: TestContext) {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'runsc-store-'));
  await chmod(root, 0o700);
  const directory = join(root, 'reservations');
  const bundleRoot = join(root, 'bundles');
  await mkdir(directory, { mode: 0o700 });
  await mkdir(bundleRoot, { mode: 0o700 });
  t.after(() => rm(root, { recursive: true, force: true }));
  const options = { directory, bundleRoot, maxRecords: 4 };
  return {
    root,
    directory,
    bundleRoot,
    options,
    record: () => record(bundleRoot),
    open: () => FileRunscLaunchStore.open(options),
  };
}

test('reservation schema binds exact assignment, fixed bundle path and declared config digest', () => {
  const value = record();
  const encoded = makeRunscReservation(value, digest, '/private/bundles');
  assert.equal(encoded.version, 1);
  assert.deepEqual(encoded.record, value);
  assert.equal(encoded.configDigest, digest);
  assert.ok(Object.isFrozen(encoded.record.identity));
  for (const changed of [
    { ...value, sandboxId: 'foreign' },
    { ...value, bundle: '/outside/bundle' },
    { ...value, identity: { ...value.identity, epoch: 0 } },
    { ...value, credential: 'must-never-be-stored' },
    { ...value, identity: { ...value.identity, nonce: 'not-metadata' } },
  ]) {
    assert.throws(() =>
      makeRunscReservation(changed, digest, '/private/bundles'),
    );
  }
  assert.throws(() =>
    makeRunscReservation(value, 'unverified', '/private/bundles'),
  );
  assert.throws(() =>
    makeRunscReservation(value, digest, '/private/../bundles'),
  );
});

test(
  'unsupported host refuses before creating files',
  { skip: process.platform === 'linux' },
  async () => {
    await assert.rejects(
      FileRunscLaunchStore.open({
        directory: 'not-a-directory',
        bundleRoot: 'not-a-directory',
        maxRecords: 4,
      }),
      /unavailable/,
    );
  },
);

test(
  'concurrent reserve commits once, replays exactly and rejects all binding/config conflicts',
  linux,
  async (t) => {
    const f = await fixture(t);
    const store = await f.open();
    const value = f.record();
    const pending = store.reserve(value, digest);
    const expected = structuredClone(value);
    value.identity.bootId = 'mutated';
    const [first, replay] = await Promise.all([
      pending,
      store.reserve(expected, digest),
    ]);
    assert.equal(first.fresh, true);
    assert.equal(replay.fresh, false);
    assert.deepEqual(await store.lookup(expected.sandboxId), first.reservation);
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
        ...expected,
        identity: {
          ...expected.identity,
          [key]: typeof expected.identity[key] === 'number' ? 2 : 'foreign',
        },
      };
      await assert.rejects(store.reserve(wrong, digest), /conflict/);
    }
    await assert.rejects(
      store.reserve(expected, `sha256:${'b'.repeat(64)}`),
      /conflict/,
    );
    assert.equal(
      (await stat(join(f.directory, `${expected.sandboxId}.reservation`)))
        .mode & 0o077,
      0,
    );
    await store.close();
  },
);

test(
  'reopen retains reservation but denies new work and exposes no retirement operation',
  linux,
  async (t) => {
    const f = await fixture(t);
    const store = await f.open();
    const value = f.record();
    assert.equal(store.recoveryRequired, false);
    await store.reserve(value, digest);
    await store.close();
    const recovered = await f.open();
    assert.equal(recovered.recoveryRequired, true);
    assert.equal((await recovered.reserve(value, digest)).fresh, false);
    await assert.rejects(recovered.reserve(f.record(), digest), /recovery/);
    assert.deepEqual((await recovered.lookup(value.sandboxId))?.record, value);
    await recovered.close();
  },
);

test(
  'exclusive writer lock cannot be stolen; close waits queued writes and immediately denies intake',
  linux,
  async (t) => {
    const f = await fixture(t);
    const store = await f.open();
    await assert.rejects(f.open(), /unavailable/);
    const value = f.record();
    const writing = store.reserve(value, digest);
    const closing = store.close();
    await assert.rejects(store.lookup(value.sandboxId), /unavailable/);
    await writing;
    await closing;
    await store.close();
    const recovered = await f.open();
    assert.ok(await recovered.lookup(value.sandboxId));
    await recovered.close();
  },
);

test(
  'capacity and concurrent intake are bounded without eviction or poisoning a valid store',
  linux,
  async (t) => {
    const f = await fixture(t);
    const store = await FileRunscLaunchStore.open({
      ...f.options,
      maxRecords: 1,
    });
    const value = f.record();
    await store.reserve(value, digest);
    await assert.rejects(store.reserve(f.record(), digest), /capacity/);
    const reads = Array.from({ length: 8 }, () =>
      store.lookup(value.sandboxId),
    );
    await assert.rejects(store.lookup(value.sandboxId), /capacity/);
    assert.equal((await Promise.all(reads)).filter(Boolean).length, 8);
    assert.equal((await store.reserve(value, digest)).fresh, false);
    await store.close();
  },
);

test(
  'explicit retained close drains writes, preserves exact lock and cannot later unlock',
  linux,
  async (t) => {
    const f = await fixture(t);
    const store = await f.open();
    const before = await readFile(join(f.directory, 'writer.lock'));
    const value = f.record();
    const writing = store.reserve(value, digest);
    const options = { retainLock: true };
    const closing = store.close(options);
    options.retainLock = false;
    await writing;
    await closing;
    await store.close();
    assert.deepEqual(await readFile(join(f.directory, 'writer.lock')), before);
    await assert.rejects(f.open());
    assert.ok(
      await readFile(join(f.directory, `${value.sandboxId}.reservation`)),
    );
  },
);

test(
  'partial files, malformed/oversize records and symlink/hardlink records fail closed and remain intact',
  linux,
  async (t) => {
    for (const mode of [
      'partial',
      'malformed',
      'oversize',
      'symlink',
      'hardlink',
    ] as const) {
      const f = await fixture(t);
      const value = f.record();
      const path = join(f.directory, `${value.sandboxId}.reservation`);
      const source = join(f.root, 'source');
      await writeFile(source, 'foreign', { mode: 0o600 });
      if (mode === 'partial') {
        await writeFile(
          join(f.directory, `${value.sandboxId}.partial`),
          'partial',
          { mode: 0o600 },
        );
      }
      if (mode === 'malformed') {
        await writeFile(path, '{', { mode: 0o600 });
      }
      if (mode === 'oversize') {
        await writeFile(path, 'x'.repeat(8193), { mode: 0o600 });
      }
      if (mode === 'symlink') {
        await symlink(source, path);
      }
      if (mode === 'hardlink') {
        await link(source, path);
      }
      await assert.rejects(f.open(), /unavailable/);
      assert.equal(await readFile(source, 'utf8'), 'foreign');
      assert.ok(
        (await readdir(f.directory)).includes('writer.lock'),
        'uncertain store retains lock',
      );
    }
  },
);

test(
  'private canonical roots required; replaced directory/lock poisons ownership without deleting foreign lock',
  linux,
  async (t) => {
    const f = await fixture(t);
    await chmod(f.directory, 0o755);
    await assert.rejects(f.open());
    await chmod(f.directory, 0o700);
    const alias = join(f.root, 'alias');
    await symlink(f.directory, alias);
    await assert.rejects(
      FileRunscLaunchStore.open({ ...f.options, directory: alias }),
    );
    const store = await f.open();
    await rename(f.directory, join(f.root, 'old-reservations'));
    await mkdir(f.directory, { mode: 0o700 });
    await writeFile(join(f.directory, 'writer.lock'), 'foreign', {
      mode: 0o600,
    });
    await assert.rejects(store.lookup(f.record().sandboxId));
    await assert.rejects(store.close());
    assert.equal(
      await readFile(join(f.directory, 'writer.lock'), 'utf8'),
      'foreign',
    );
    assert.ok(
      (await readdir(join(f.root, 'old-reservations'))).includes('writer.lock'),
    );
  },
);

test(
  'mutated or missing committed metadata poisons the store rather than becoming a fresh reservation',
  linux,
  async (t) => {
    for (const mode of ['missing', 'corrupt', 'changed']) {
      const f = await fixture(t);
      const store = await f.open();
      const value = f.record();
      await store.reserve(value, digest);
      const path = join(f.directory, `${value.sandboxId}.reservation`);
      if (mode === 'missing') {
        await unlink(path);
      } else if (mode === 'corrupt') {
        await writeFile(path, '{}', { mode: 0o600 });
      } else {
        const changed = makeRunscReservation(
          { ...value, identity: { ...value.identity, bootId: randomUUID() } },
          digest,
          f.bundleRoot,
        );
        await writeFile(path, JSON.stringify(changed), { mode: 0o600 });
      }
      await assert.rejects(store.lookup(value.sandboxId));
      await assert.rejects(store.reserve(value, digest));
      await assert.rejects(store.close());
      assert.ok((await readdir(f.directory)).includes('writer.lock'));
    }
  },
);

test(
  'unexpected final record is never overwritten and ambiguous append retains partial and lock',
  linux,
  async (t) => {
    const f = await fixture(t);
    const store = await f.open();
    const value = f.record();
    const path = join(f.directory, `${value.sandboxId}.reservation`);
    await writeFile(path, 'foreign', { mode: 0o600 });
    await assert.rejects(store.reserve(value, digest));
    assert.equal(await readFile(path, 'utf8'), 'foreign');
    assert.ok(
      (await readdir(f.directory)).includes(`${value.sandboxId}.partial`),
    );
    await assert.rejects(store.close());
    assert.ok((await readdir(f.directory)).includes('writer.lock'));
  },
);

test(
  'SIGKILL after reservation before spawn retains a stale lock and cannot cause a second launch',
  { ...linux, timeout: 15000 },
  async (t) => {
    const f = await fixture(t);
    const value = f.record();
    const child = fork(
      new URL('./support/runsc-launch-crash.fixture.ts', import.meta.url),
      [],
      {
        execArgv: ['--import', 'tsx'],
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      },
    );
    t.after(() => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
      }
    });
    const message = once(child, 'message');
    child.send({ options: f.options, record: value, digest });
    const [saved] = await message;
    assert.deepEqual(saved, { state: 'RESERVED', sandboxId: value.sandboxId });
    const exited = once(child, 'exit');
    child.kill('SIGKILL');
    await exited;
    await assert.rejects(f.open());
    // This test owns/reaped the exact process, which never spawned a runtime. This
    // is not a production unlock protocol or proof about orphan runsc processes.
    await unlink(join(f.directory, 'writer.lock'));
    const store = await f.open();
    let starts = 0;
    const driver = new RunscSandboxDriver({
      async reserve(binding, id) {
        const result = await store.reserve(
          { identity: binding, sandboxId: id, bundle: value.bundle },
          digest,
        );
        return { record: result.reservation.record, fresh: result.fresh };
      },
      async lookup(id) {
        return (await store.lookup(id))?.record ?? null;
      },
      start() {
        starts++;
        throw new Error('must never run');
      },
      async state() {
        return null;
      },
      async signalAll() {
        throw new Error('no observed sandbox');
      },
      async destroy() {
        throw new Error('no termination witness');
      },
      async cgroupEmpty() {
        return true;
      },
    });
    const handle = await driver.launch(value.identity);
    assert.equal(starts, 0);
    assert.equal(await handle.inspect(), 'UNKNOWN');
    assert.equal((await store.reserve(value, digest)).fresh, false);
    await store.close();
  },
);
