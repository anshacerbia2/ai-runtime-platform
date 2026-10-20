import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseProbeProcessStat } from './gvisor-owner-process.mjs';

/** Disposable privileged experiment only; never a production recovery/unlock API. */
export async function probeOwnerCrash({
  workspace,
  processOptions,
  producerOptions,
  identity,
  inspector,
  fixtures,
  runtime,
  until,
}) {
  const { FileRunscLaunchStore } =
    await import('../../apps/runner/dist/file-runsc-launch-store.js');
  const { runscSandboxId, runscBindingAnnotation } =
    await import('../../apps/runner/dist/runsc-sandbox-driver.js');
  const { parseRunscList } = await import('./gvisor-profile.mjs');
  const bundleRoot = join(workspace, 'crash-bundles');
  const directory = join(workspace, 'crash-reservations');
  await mkdir(bundleRoot, { mode: 0o700 });
  await mkdir(directory, { mode: 0o700 });
  const storeOptions = { directory, bundleRoot, maxRecords: 256 };
  const id = runscSandboxId(identity);
  const bundle = join(bundleRoot, id);
  let owner;
  let ownerExited;
  let monitorIdentity;
  const processIdentity = async (pid) => {
    try {
      const value = parseProbeProcessStat(
        await readFile(`/proc/${pid}/stat`, 'utf8'),
      );
      assert.equal(value.pid, pid);
      return value;
    } catch (error) {
      if (error.code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  };
  const originalMonitor = async () => {
    if (!monitorIdentity) {
      throw new Error('Original crash-fixture monitor remains unconfirmed.');
    }
    const observed = await processIdentity(monitorIdentity.pid);
    return observed?.startTicks === monitorIdentity.startTicks
      ? observed
      : null;
  };
  const item = {
    identity: { ...identity, sandboxId: id },
    driverBinding: identity,
    bundle,
    cgroup: join('/sys/fs/cgroup', id),
    deleted: false,
    async beforeRemove() {
      if (owner && owner.exitCode === null && owner.signalCode === null) {
        owner.kill('SIGKILL'); // Only the child handle created by this fixture.
      }
      await ownerExited;
    },
    async reapMonitor() {
      // No numeric PID/group signals or fabricated exit code. After exact runtime
      // deletion the original orphan must actually disappear (PID 1 reaps it).
      await until(async () => (await originalMonitor()) === null);
    },
  };
  fixtures.push(item); // Register every cleanup obligation before starting owner.
  owner = fork(
    new URL('./gvisor-owner-crash-child.mjs', import.meta.url),
    ['--disposable-linux-host'],
    {
      env: { PATH: '/usr/sbin:/usr/bin:/sbin:/bin', LANG: 'C' },
      execArgv: [],
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    },
  );
  ownerExited = new Promise((resolve, reject) => {
    owner.once('exit', (code, signal) => resolve({ code, signal }));
    owner.once('error', reject);
  });
  void ownerExited.catch(() => {});
  item.completion = ownerExited;
  let outputBytes = 0;
  const consume = (chunk) => {
    outputBytes += chunk.length;
    if (outputBytes > 65536) {
      owner.kill('SIGKILL');
    }
  };
  owner.stdout.on('data', consume);
  owner.stderr.on('data', consume);
  let timer;
  const ready = new Promise((resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error('Live owner crash barrier timed out.')),
      10000,
    );
    owner.once('error', reject);
    owner.once('exit', () =>
      reject(new Error('Owner exited before live crash barrier.')),
    );
    owner.once('message', (message) => {
      try {
        assert.equal(message.state, 'RUNNING');
        assert.equal(message.sandboxId, id);
        assert.match(message.configDigest, /^sha256:[a-f0-9]{64}$/);
        resolve(message);
      } catch (error) {
        reject(error);
      }
    });
  });
  owner.send(
    {
      storeOptions,
      producerOptions: { ...producerOptions, bundleRoot },
      processOptions: { ...processOptions, bundleRoot },
      identity,
    },
    (error) => {
      if (error) {
        owner.kill('SIGKILL');
      }
    },
  );
  try {
    await ready;
  } finally {
    clearTimeout(timer);
  }
  const childPids = (
    await readFile(`/proc/${owner.pid}/task/${owner.pid}/children`, 'utf8')
  )
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  assert.ok(childPids.length <= 16);
  for (const value of childPids) {
    assert.match(value, /^[1-9][0-9]{0,9}$/);
    const pid = Number(value);
    const args = (await readFile(`/proc/${pid}/cmdline`))
      .toString('utf8')
      .split('\0');
    if (args.includes('run') && args.includes(id) && args.includes(bundle)) {
      assert.equal(
        monitorIdentity,
        undefined,
        'Only one original attached monitor.',
      );
      monitorIdentity = await processIdentity(pid);
      assert.equal(monitorIdentity?.parent, owner.pid);
    }
  }
  assert.ok(monitorIdentity);
  const lockPath = join(directory, 'writer.lock');
  const reservationPath = join(directory, `${id}.reservation`);
  const lockBefore = await readFile(lockPath);
  const reservationBefore = await readFile(reservationPath);
  const configBefore = await readFile(join(bundle, 'config.json'));
  assert.equal(await inspector.empty(identity), false);
  owner.kill('SIGKILL'); // Only the owner dies; its attached runtime is not signalled.
  assert.deepEqual(await ownerExited, { code: null, signal: 'SIGKILL' });
  assert.ok(await originalMonitor());
  const state = JSON.parse((await runtime(['state', id])).stdout);
  assert.equal(state.id, id);
  assert.equal(state.bundle, bundle);
  assert.equal(state.status, 'running');
  assert.equal(
    state.annotations?.[runscBindingAnnotation],
    JSON.stringify(identity),
  );
  assert.equal(
    await inspector.empty(identity),
    false,
    'Owner death cannot establish empty guest subtree.',
  );
  let recoveryStarts = 0;
  await assert.rejects(async () => {
    const reopened = await FileRunscLaunchStore.open(storeOptions);
    recoveryStarts++;
    await reopened.close();
    throw new Error('Stale owner lock was unexpectedly acquired.');
  });
  assert.equal(recoveryStarts, 0);
  assert.deepEqual(await readFile(lockPath), lockBefore);
  assert.deepEqual(await readFile(reservationPath), reservationBefore);
  assert.deepEqual(await readFile(join(bundle, 'config.json')), configBefore);
  assert.equal(
    parseRunscList((await runtime(['list', '--format=json'])).stdout).filter(
      (row) => row.id === id,
    ).length,
    1,
  );
  // Disposable host-admin cleanup of this exact, already-observed binding.
  const beforeSignal = JSON.parse((await runtime(['state', id])).stdout);
  assert.equal(beforeSignal.id, id);
  assert.equal(beforeSignal.bundle, bundle);
  assert.equal(beforeSignal.status, 'running');
  assert.equal(
    beforeSignal.annotations?.[runscBindingAnnotation],
    JSON.stringify(identity),
  );
  await runtime(['kill', '--all', id, 'KILL']);
  await item.beforeRemove();
  await runtime(['delete', '--force', id]);
  await until(() => inspector.empty(identity));
  assert.ok(
    parseRunscList((await runtime(['list', '--format=json'])).stdout).every(
      (row) => row.id !== id,
    ),
  );
  await item.reapMonitor();
  item.deleted = true;
  await assert.rejects(FileRunscLaunchStore.open(storeOptions));
  assert.deepEqual(
    await readFile(lockPath),
    lockBefore,
    'Cleanup cannot silently unlock or authorize new work.',
  );
  assert.deepEqual(await readFile(reservationPath), reservationBefore);
}
