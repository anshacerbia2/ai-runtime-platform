import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { openNativeRunnerWorker } from '../../apps/runner/dist/native-runner-worker.js';
import { RunnerWorker } from '../../apps/runner/dist/runner-worker.js';
import { RunscHostLifecycle } from '../../apps/runner/dist/runsc-host-lifecycle.js';
import { FileRunscLaunchStore } from '../../apps/runner/dist/file-runsc-launch-store.js';
import { FileRunscBundleProducer } from '../../apps/runner/dist/file-runsc-bundle-producer.js';
import { RunscProcessClient } from '../../apps/runner/dist/runsc-process-client.js';
import { RunscCgroupInspector } from '../../apps/runner/dist/runsc-cgroup-inspector.js';
import {
  RunscSandboxDriver,
  runscSandboxId,
  captureRunscIdentity,
  runscBindingAnnotation,
} from '../../apps/runner/dist/runsc-sandbox-driver.js';

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
class Timers {
  now = 0;
  next = 0;
  tasks = new Map();
  schedule(callback, delay) {
    const id = ++this.next;
    this.tasks.set(id, { at: this.now + delay, callback });
    return id;
  }
  cancel(id) {
    this.tasks.delete(id);
  }
  advance(now) {
    this.now = now;
    for (let i = 0; i < 100; i++) {
      const due = [...this.tasks]
        .filter(([, value]) => value.at <= now)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) {
        return;
      }
      this.tasks.delete(due[0]);
      due[1].callback();
    }
    throw new Error('Fixture timer did not settle.');
  }
}

/** Controlled coordinator replies + real worker/host/runsc/kernel; no live coordinator or provider. */
export async function probeWorkerLifetime({
  workspace,
  producerOptions,
  processOptions,
  inspector,
  until,
  command,
  additionalCleanup,
}) {
  for (const mode of [
    'signal',
    'renewal-fence',
    'cancel-preflight',
    'prepare-expiry',
    'lost',
  ]) {
    const directory = join(workspace, `worker-${mode}`);
    await mkdir(directory, { mode: 0o700 });
    for (const name of ['bundles', 'reservations', 'state']) {
      await mkdir(join(directory, name), { mode: 0o700 });
    }
    const nativeOptions = {
      directory,
      imageRoot: producerOptions.imageRoot,
      manifest: producerOptions.manifest,
      approvedRootfsDigest: producerOptions.approvedRootfsDigest,
      program:
        producerOptions.programs[mode === 'lost' ? 'forced' : 'graceful'],
      executable: processOptions.executable,
      approvedExecutableSha256: processOptions.approvedExecutableSha256,
      commandTimeoutMs: 5000,
      runTimeoutMs: mode === 'lost' ? 3000 : 15000,
    };
    const adminOptions = {
      ...processOptions,
      bundleRoot: join(directory, 'bundles'),
      stateRoot: join(directory, 'state'),
    };
    const grant = {
      assignmentId: randomUUID(),
      executionId: randomUUID(),
      attemptId: randomUUID(),
      runnerId: 'native-worker-fixture',
      ownerSubject: 'native-worker-owner',
      generation: 1,
      epoch: 2,
      state: 'GRANTED',
      protocolVersion: '1',
      envelopeId: randomUUID(),
      inputDigest: 'a'.repeat(64),
      plaintextBytes: 10,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      plugin: null,
    };
    const timers = new Timers();
    const shutdown = new AbortController();
    let preparationSeen = false;
    const releasePreparation = deferred();
    const monitors = [];
    const requests = [];
    let worker;
    let host;
    let context;
    let record;
    let fenced = false;
    let claimed = false;
    let runCalls = 0;
    let clean = false;
    let closed = false;
    let store;
    let producer;
    let client;
    let cgroups;
    const cleanup = async () => {
      releasePreparation.resolve();
      if (worker && !closed) {
        worker.quiesce();
        await worker.close();
        closed = true;
      } else if (!worker && host) {
        await host.close({ retainLock: true }).catch(() => {});
      } else if (!worker) {
        await Promise.allSettled([
          producer?.close(),
          client?.close(),
          cgroups?.close(),
        ]);
        await store?.close({ retainLock: true }).catch(() => {});
      }
      if (record && !clean) {
        // Administrative disposable-fixture cleanup only. No unlock or rerun.
        const admin = await RunscProcessClient.open(adminOptions);
        try {
          if ((await admin.list()).some((row) => row.id === record.sandboxId)) {
            const state = await admin.readState(record);
            assert.equal(state.id, record.sandboxId);
            assert.equal(state.bundle, record.bundle);
            assert.equal(
              state.annotations?.[runscBindingAnnotation],
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
      const cache = join(directory, 'state', 'null-netns');
      if (
        (await readFile('/proc/self/mountinfo', 'utf8'))
          .split('\n')
          .some((line) => line.split(' ')[4] === cache)
      ) {
        await command('/usr/bin/umount', ['--', cache]);
      }
    };
    additionalCleanup.push(cleanup);
    const options = {
      runnerId: grant.runnerId,
      ownerSubject: grant.ownerSubject,
      registrationRevision: 3,
      capacity: 1,
      timers,
      clock: { nowMs: () => timers.now },
      shutdownSignal: shutdown.signal,
      drainGraceMs: 0,
      http: {
        origin: 'https://controlled-coordinator.invalid',
        timeoutMs: 1000,
        bearerToken: async () => 'inert-fixture-token',
        fetchImpl: async (input, init) => {
          const path = new URL(String(input)).pathname;
          const body = JSON.parse(String(init?.body));
          requests.push({ path, body });
          if (path.endsWith('/heartbeat')) {
            return Response.json({
              ...body,
              state: 'ALIVE',
              heartbeatIntervalMs: 5000,
              presenceTtlMs: 15000,
            });
          }
          if (path.endsWith('/claim')) {
            const value = claimed ? null : grant;
            claimed = true;
            return Response.json({ grant: value });
          }
          if (path.endsWith('/activate')) {
            assert.equal(body.bootId, worker.identity.bootId);
            assert.deepEqual(body.token, {
              assignmentId: grant.assignmentId,
              executionId: grant.executionId,
              attemptId: grant.attemptId,
              runnerId: grant.runnerId,
              generation: grant.generation,
              epoch: grant.epoch,
            });
            return fenced
              ? new Response(null, { status: 409 })
              : Response.json({
                  state: 'ACTIVE',
                  leaseTtlMs: 15000,
                  renewIntervalMs: 5000,
                });
          }
          assert.ok(path.endsWith('/reports') && body.type === 'started');
          return Response.json({
            ...body.token,
            ownerSubject: grant.ownerSubject,
            state: 'STARTED',
            protocolVersion: '1',
          });
        },
      },
      runtime: {
        async execute(_grant, value) {
          context = value;
          if (!value.signal.aborted) {
            await new Promise((resolve) =>
              value.signal.addEventListener('abort', resolve, { once: true }),
            );
          }
        },
      },
    };
    if (mode === 'prepare-expiry' || mode === 'lost') {
      // Trusted test composition wraps a preparation barrier and run counter;
      // bundles, persistence, process transport and kernel inspector are real.
      store = await FileRunscLaunchStore.open({
        directory: join(directory, 'reservations'),
        bundleRoot: adminOptions.bundleRoot,
        maxRecords: 256,
      });
      producer = await FileRunscBundleProducer.open({
        ...producerOptions,
        bundleRoot: adminOptions.bundleRoot,
        programs: { agent: nativeOptions.program },
      });
      client = await RunscProcessClient.open({
        ...adminOptions,
        runTimeoutMs: nativeOptions.runTimeoutMs,
      });
      assert.equal((await client.list()).length, 0);
      cgroups = await RunscCgroupInspector.open();
      host = new RunscHostLifecycle(
        {
          store,
          bundles: {
            get recoveryRequired() {
              return producer.recoveryRequired;
            },
            async prepare(identity, program) {
              const value = await producer.prepare(identity, program);
              preparationSeen = true;
              if (mode === 'prepare-expiry') {
                await releasePreparation.promise;
              }
              return value;
            },
            verify: producer.verify.bind(producer),
            close: producer.close.bind(producer),
          },
          runtime: {
            get recoveryRequired() {
              return client.recoveryRequired;
            },
            list: client.list.bind(client),
            readState: client.readState.bind(client),
            signalAll: client.signalAll.bind(client),
            destroy: client.destroy.bind(client),
            close: client.close.bind(client),
            run(value, guard) {
              runCalls++;
              const monitor = client.run(value, guard);
              monitors.push(monitor.finished);
              return monitor;
            },
          },
          cgroups,
        },
        {
          bundleRoot: adminOptions.bundleRoot,
          program: 'agent',
          approvedRootfsDigest: nativeOptions.approvedRootfsDigest,
        },
      );
      worker = new RunnerWorker({
        ...options,
        driver: new RunscSandboxDriver(host),
        sandboxLifecycle: host,
      });
    } else {
      worker = await openNativeRunnerWorker(nativeOptions, options);
    }
    const identity = captureRunscIdentity({
      ...grant,
      bootId: worker.identity.bootId,
    });
    record = {
      identity,
      sandboxId: runscSandboxId(identity),
      bundle: join(adminOptions.bundleRoot, runscSandboxId(identity)),
    };
    const lockPath = join(directory, 'reservations', 'writer.lock');
    const lockBytes = await readFile(lockPath);
    await worker.start();
    timers.advance(0);
    if (mode === 'prepare-expiry') {
      await until(async () => preparationSeen);
      // Do not fire renewal/watchdog callbacks: the final monotonic guard must
      // deny dispatch after real asynchronous file preparation finishes.
      timers.now = 15000;
      releasePreparation.resolve();
      await until(async () => (await store.lookup(record.sandboxId)) !== null);
    } else {
      await until(async () => context !== undefined);
      const admin = await RunscProcessClient.open(adminOptions);
      try {
        const state = await admin.readState(record);
        assert.equal(
          state.annotations?.[runscBindingAnnotation],
          JSON.stringify(identity),
        );
      } finally {
        await admin.close();
      }
      if (mode === 'signal') {
        shutdown.abort();
      }
      if (mode === 'renewal-fence') {
        fenced = true;
        timers.advance(5000);
        await until(async () => context.signal.aborted);
      }
      if (mode === 'cancel-preflight') {
        fenced = true;
        let effects = 0;
        await assert.rejects(
          context.runStep(async () => {
            effects++;
          }),
        );
        assert.equal(effects, 0);
        assert.equal(context.signal.aborted, true);
      }
      if (mode === 'lost') {
        assert.equal((await monitors[0]).state, 'LOST');
      }
    }
    const result = await worker.close();
    closed = true;
    assert.equal(timers.tasks.size, 0);
    assert.equal(
      requests.some((item) => item.body.type === 'result.proposed'),
      false,
    );
    assert.equal(result.assignments.length, 1);
    assert.deepEqual(result.assignments[0].identity, identity);
    if (mode === 'prepare-expiry' || mode === 'lost') {
      assert.equal(result.ownership, 'UNCONFIRMED');
      assert.deepEqual(await readFile(lockPath), lockBytes);
      if (mode === 'prepare-expiry') {
        assert.equal(runCalls, 0);
        assert.equal(context, undefined);
        assert.equal(result.assignments[0].evidence.state, 'UNCONFIRMED');
      } else {
        assert.equal(runCalls, 1);
      }
    } else {
      assert.equal(result.ownership, 'RELEASED');
      assert.equal(result.assignments[0].evidence.state, 'TERMINATED');
      assert.equal(context.signal.aborted, true);
      await assert.rejects(access(lockPath), { code: 'ENOENT' });
    }
    await cleanup();
    if (mode === 'prepare-expiry' || mode === 'lost') {
      await assert.rejects(
        FileRunscLaunchStore.open({
          directory: join(directory, 'reservations'),
          bundleRoot: adminOptions.bundleRoot,
          maxRecords: 256,
        }),
      );
      assert.deepEqual(await readFile(lockPath), lockBytes);
    }
    console.log(`gVisor worker lifetime PASS: ${mode}`);
  }
}
