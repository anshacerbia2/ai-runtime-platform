import assert from 'node:assert/strict';
import { mkdir, readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { NativeRunscHost } from '../../apps/runner/dist/native-runsc-host.js';
import { FileRunscLaunchStore } from '../../apps/runner/dist/file-runsc-launch-store.js';
import { RunscProcessClient } from '../../apps/runner/dist/runsc-process-client.js';
import {
  RunscSandboxDriver,
  runscSandboxId,
} from '../../apps/runner/dist/runsc-sandbox-driver.js';
import { LocalSandboxSupervisor } from '../../apps/runner/dist/sandbox-supervisor.js';

/** Real components in separate disposable namespaces; no production startup path. */
export async function probeHostLifecycle({
  workspace,
  producerOptions,
  processOptions,
  binding,
  inspector,
  until,
  command,
  additionalCleanup,
}) {
  for (const mode of ['clean', 'pending', 'lost']) {
    const directory = join(workspace, `host-${mode}`);
    await mkdir(directory, { mode: 0o700 });
    for (const name of ['bundles', 'reservations', 'state']) {
      await mkdir(join(directory, name), { mode: 0o700 });
    }
    const options = {
      directory,
      imageRoot: producerOptions.imageRoot,
      manifest: producerOptions.manifest,
      approvedRootfsDigest: producerOptions.approvedRootfsDigest,
      program:
        mode === 'pending'
          ? ['/bin/busybox', 'sleep', '1']
          : producerOptions.programs[mode === 'clean' ? 'graceful' : 'forced'],
      executable: processOptions.executable,
      approvedExecutableSha256: processOptions.approvedExecutableSha256,
      commandTimeoutMs: 5000,
      runTimeoutMs: mode === 'lost' ? 1000 : 15000,
    };
    let host;
    let record;
    let supervisor;
    let closed = false;
    let clean = false;
    const adminOptions = {
      ...processOptions,
      bundleRoot: join(directory, 'bundles'),
      stateRoot: join(directory, 'state'),
    };
    const cleanup = async () => {
      if (!clean && record) {
        // Fixed-ID administrative fixture cleanup, independent of a closed/LOST
        // host. The launch lock stays retained; this never permits new work.
        const admin = await RunscProcessClient.open(adminOptions);
        try {
          if ((await admin.list()).some((row) => row.id === record.sandboxId)) {
            const state = await admin.readState(record);
            assert.equal(state.id, record.sandboxId);
            assert.equal(state.bundle, record.bundle);
            assert.equal(
              state.annotations?.['org.ai-runtime.runner.binding.v1'],
              JSON.stringify(record.identity),
            );
            await admin.destroy(record);
          }
          await until(() => inspector.empty(record.identity));
          assert.equal((await admin.list()).length, 0);
          clean = true;
        } finally {
          await admin.close();
        }
      }
      if (host && !closed) {
        supervisor?.quiesce();
        await host.close().catch(() => {});
        closed = true;
      }
      // Only this exact owned runtime cache, after runtime/cgroup cleanup.
      const cache = join(directory, 'state', 'null-netns');
      const mounted = (await readFile('/proc/self/mountinfo', 'utf8'))
        .split('\n')
        .some((line) => line.split(' ')[4] === cache);
      if (mounted) {
        await command('/usr/bin/umount', ['--', cache]);
      }
    };
    additionalCleanup.push(cleanup);
    host = await NativeRunscHost.open(options);
    const grant = binding();
    const lockPath = join(directory, 'reservations', 'writer.lock');
    const lockBytes = await readFile(lockPath);
    await assert.rejects(NativeRunscHost.open(options));
    assert.deepEqual(await readFile(lockPath), lockBytes);
    if (mode === 'clean') {
      const driver = new RunscSandboxDriver(host);
      supervisor = new LocalSandboxSupervisor(driver);
      // Register cleanup before run, even if startup fails.
      const reserved = await host.reserve(grant, runscSandboxId(grant));
      record = reserved.record;
      const monitor = host.start(record);
      await monitor.ready;
      const recovered = await driver.launch(grant);
      assert.equal(await recovered.inspect(), 'RUNNING');
      await supervisor.start(grant);
      assert.equal(
        (await supervisor.stopTracked())[0].evidence.state,
        'TERMINATED',
      );
      assert.equal(await monitor.finished, 'REAPED');
      await host.close();
      closed = true;
      clean = true;
      await assert.rejects(access(lockPath), { code: 'ENOENT' });
      const store = await FileRunscLaunchStore.open({
        directory: join(directory, 'reservations'),
        bundleRoot: join(directory, 'bundles'),
        maxRecords: 256,
      });
      assert.equal(store.recoveryRequired, true);
      assert.deepEqual((await store.lookup(record.sandboxId)).record, record);
      await store.close();
    } else {
      const reserved = await host.reserve(grant, runscSandboxId(grant));
      record = reserved.record;
      const monitor = host.start(record);
      const ready = monitor.ready.catch(() => {});
      if (mode === 'pending') {
        const closing = host.close();
        assert.throws(() => host.start(record));
        // Even absent runtime state at this point cannot release the lock while
        // the attached original run still has permission to create the guest.
        assert.deepEqual(await readFile(lockPath), lockBytes);
        await assert.rejects(NativeRunscHost.open(options));
        await closing;
        assert.equal(await monitor.finished, 'REAPED');
        await ready;
        closed = true;
        clean = true;
        await assert.rejects(access(lockPath), { code: 'ENOENT' });
      } else {
        assert.equal(await monitor.finished, 'LOST');
        await ready;
        const replay = await host.reserve(grant, record.sandboxId);
        assert.equal(replay.fresh, false);
        assert.throws(() => host.start(replay.record));
        // Independent admin cleanup before close cannot turn LOST into REAPED.
        const admin = await RunscProcessClient.open(adminOptions);
        try {
          const rows = await admin.list();
          if (rows.some((row) => row.id === record.sandboxId)) {
            const state = await admin.readState(record);
            assert.equal(state.bundle, record.bundle);
            assert.equal(
              state.annotations?.['org.ai-runtime.runner.binding.v1'],
              JSON.stringify(record.identity),
            );
            await admin.destroy(record);
          }
          await until(() => inspector.empty(grant));
          assert.equal((await admin.list()).length, 0);
        } finally {
          await admin.close();
        }
        clean = true;
        await assert.rejects(host.close(), /ownership retained/);
        closed = true;
        assert.deepEqual(await readFile(lockPath), lockBytes);
        await assert.rejects(NativeRunscHost.open(options));
        assert.deepEqual(await readFile(lockPath), lockBytes);
      }
    }
    await cleanup();
    console.log(`gVisor host lifecycle PASS: ${mode}`);
  }
}
