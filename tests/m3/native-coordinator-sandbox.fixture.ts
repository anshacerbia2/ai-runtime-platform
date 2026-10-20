import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { release, tmpdir } from 'node:os';
import {
  access,
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { NativeRunscHost } from '../../apps/runner/src/native-runsc-host.js';
import { RunscProcessClient } from '../../apps/runner/src/runsc-process-client.js';
import { RunscCgroupInspector } from '../../apps/runner/src/runsc-cgroup-inspector.js';
import {
  rootfsManifestDigest,
  type RootfsManifest,
} from '../../apps/runner/src/runsc-bundle.js';
import {
  RunscSandboxDriver,
  runscBindingAnnotation,
  type RunscLaunchRecord,
  type RunscSandboxHost,
} from '../../apps/runner/src/runsc-sandbox-driver.js';
import {
  RunnerWorker,
  type RunnerWorkerOptions,
} from '../../apps/runner/src/runner-worker.js';
import { until } from './worker-coordinators.fixture.js';

const busyboxPin =
  'dbac288c29ba568459550a2da9e7ae0ded6b1fc728ee9fad3044c44e62d6ac14';
const runscPin =
  '56996c546dbafd5716e1d09e307a131d97eb3b6483c22a1178631751f3e0392f';
const execute = promisify(execFile);

/** Refuse before any FS, DB or process operation outside the explicit root Linux gate. */
function binaries() {
  const kernel = /^(\d+)\.(\d+)\./.exec(release());
  if (
    process.platform !== 'linux' ||
    process.arch !== 'x64' ||
    process.geteuid?.() !== 0 ||
    process.env.M3_NATIVE_COORDINATOR_DISPOSABLE !== '1' ||
    !kernel ||
    +kernel[1]! < 5 ||
    (+kernel[1]! === 5 && +kernel[2]! < 6)
  ) {
    throw new Error(
      'Require explicit disposable Linux 5.6+ x64 root native coordinator gate; no fallback.',
    );
  }
  const runsc = process.env.M3_NATIVE_RUNSC_PATH;
  const busybox = process.env.M3_NATIVE_BUSYBOX_PATH;
  if (!runsc || !busybox || !isAbsolute(runsc) || !isAbsolute(busybox)) {
    throw new Error('Require absolute pinned fixture binaries.');
  }
  return { runsc, busybox };
}

export async function nativeCoordinatorSandbox() {
  const paths = binaries();
  for (const path of [paths.runsc, paths.busybox]) {
    const info = await lstat(await realpath(path));
    assert.ok(
      info.isFile() &&
        info.uid === 0 &&
        (info.mode & 0o022) === 0 &&
        info.size > 0 &&
        info.size <= 268435456,
    );
  }
  const executable = await realpath(paths.runsc);
  const busybox = await realpath(paths.busybox);
  assert.ok((await lstat(busybox)).size <= 16777216);
  const binary = await readFile(busybox);
  assert.equal(
    createHash('sha256').update(binary).digest('hex'),
    busyboxPin,
    'Unapproved inert guest fixture.',
  );
  const parent = await realpath(tmpdir());
  const workspace = await mkdtemp(join(parent, 'airt-native-coordinator-'));
  await chmod(workspace, 0o700);
  const imageRoot = join(workspace, 'image');
  await mkdir(imageRoot, { mode: 0o700 });
  for (const name of ['bin', 'dev', 'proc', 'tmp']) {
    await mkdir(join(imageRoot, name), { mode: 0o700 });
  }
  await writeFile(join(imageRoot, 'bin/busybox'), binary, {
    flag: 'wx',
    mode: 0o555,
  });
  for (const name of ['bin', 'dev', 'proc', 'tmp']) {
    await chmod(join(imageRoot, name), 0o555);
  }
  const manifest: RootfsManifest = {
    format: 'ai-runtime-rootfs/v1',
    architecture: 'x64',
    directories: ['bin', 'dev', 'proc', 'tmp'],
    files: [
      {
        path: 'bin/busybox',
        bytes: binary.length,
        sha256: busyboxPin,
        executable: true,
      },
    ],
  };
  const inspector = await RunscCgroupInspector.open();
  const owners: Array<{
    directory: string;
    records: Map<string, RunscLaunchRecord>;
    monitors: Array<Promise<'REAPED' | 'LOST'>>;
    host?: Awaited<ReturnType<typeof NativeRunscHost.open>>;
    worker?: RunnerWorker;
  }> = [];
  let starts = 0;
  let cleaned = false;
  const processOptions = (directory: string) => ({
    executable,
    approvedExecutableSha256: runscPin,
    bundleRoot: join(directory, 'bundles'),
    stateRoot: join(directory, 'state'),
    commandTimeoutMs: 5000,
    runTimeoutMs: 30_000,
  });

  function checked(record: RunscLaunchRecord, value: unknown): string {
    assert.ok(value && typeof value === 'object' && !Array.isArray(value));
    const state = value as Record<string, unknown>;
    assert.equal(state.id, record.sandboxId);
    assert.equal(state.bundle, record.bundle);
    assert.ok(
      ['created', 'running', 'paused', 'stopped'].includes(
        String(state.status),
      ),
    );
    assert.equal(
      (state.annotations as Record<string, unknown>)?.[runscBindingAnnotation],
      JSON.stringify(record.identity),
    );
    return String(state.status);
  }

  async function createWorker(
    options: Omit<RunnerWorkerOptions, 'driver' | 'sandboxLifecycle'>,
  ) {
    if (owners.length >= 2 || cleaned) {
      throw new Error('Native coordinator fixture owner capacity exhausted.');
    }
    const directory = join(workspace, `owner-${owners.length}`);
    await mkdir(directory, { mode: 0o700 });
    for (const name of ['reservations', 'bundles', 'state']) {
      await mkdir(join(directory, name), { mode: 0o700 });
    }
    // Register the namespace before open; failed ownership acquisition must not
    // disappear from cleanup accounting or permit removal of a retained lock.
    const owner: (typeof owners)[number] = {
      directory,
      records: new Map(),
      monitors: [],
    };
    owners.push(owner);
    const host = await NativeRunscHost.open({
      ...processOptions(directory),
      directory,
      imageRoot,
      manifest,
      approvedRootfsDigest: rootfsManifestDigest(manifest),
      program: [
        '/bin/busybox',
        'sh',
        '-c',
        "trap '' TERM; /bin/busybox sh -c \"trap '' TERM; exec /bin/busybox sleep 300\" & wait",
      ],
    });
    owner.host = host;
    const tracked: RunscSandboxHost = {
      async reserve(identity, id) {
        const value = await host.reserve(identity, id);
        owner.records.set(id, value.record);
        return value;
      },
      lookup: host.lookup.bind(host),
      state: host.state.bind(host),
      signalAll: host.signalAll.bind(host),
      destroy: host.destroy.bind(host),
      cgroupEmpty: host.cgroupEmpty.bind(host),
      start(record, guard) {
        starts++;
        const monitor = host.start(record, guard);
        owner.monitors.push(monitor.finished);
        return monitor;
      },
    };
    try {
      owner.worker = new RunnerWorker({
        ...options,
        driver: new RunscSandboxDriver(tracked),
        sandboxLifecycle: host,
      });
      return owner.worker;
    } catch (error) {
      await host.close({ retainLock: true }).catch(() => {});
      throw error;
    }
  }

  async function assertClean(index: number) {
    const owner = owners[index]!;
    assert.ok(owner?.worker);
    assert.equal((await owner.worker.close()).ownership, 'RELEASED');
    assert.ok(
      (await Promise.all(owner.monitors)).every((value) => value === 'REAPED'),
    );
    const admin = await RunscProcessClient.open(
      processOptions(owner.directory),
    );
    try {
      assert.equal((await admin.list()).length, 0);
      for (const record of owner.records.values()) {
        assert.equal(await inspector.empty(record.identity), true);
        const saved = JSON.parse(
          await readFile(
            join(
              owner.directory,
              'reservations',
              `${record.sandboxId}.reservation`,
            ),
            'utf8',
          ),
        ) as {
          version: number;
          record: RunscLaunchRecord;
          configDigest: string;
        };
        assert.equal(saved.version, 1);
        assert.deepEqual(saved.record, record);
        assert.equal(
          saved.configDigest,
          `sha256:${createHash('sha256')
            .update(await readFile(join(record.bundle, 'config.json')))
            .digest('hex')}`,
        );
      }
      await assert.rejects(
        access(join(owner.directory, 'reservations', 'writer.lock')),
        { code: 'ENOENT' },
      );
    } finally {
      await admin.close();
    }
  }

  async function cleanup() {
    if (cleaned) {
      return;
    }
    const errors: unknown[] = [];
    for (const owner of owners) {
      try {
        const result = await owner.worker?.close();
        if (!owner.worker && owner.host) {
          await owner.host.close({ retainLock: true }).catch(() => {});
        }
        if (!result || result.ownership !== 'RELEASED') {
          errors.push(new Error('Host ownership remained unconfirmed.'));
        }
        const admin = await RunscProcessClient.open(
          processOptions(owner.directory),
        );
        try {
          for (const row of await admin.list()) {
            const record = owner.records.get(row.id);
            assert.ok(record, 'Never delete an untracked sandbox.');
            checked(record, await admin.readState(record));
            await admin.destroy(record);
          }
          for (const record of owner.records.values()) {
            await until(
              () => inspector.empty(record.identity),
              Boolean,
              'owned native cgroup cleanup',
            );
          }
          assert.equal((await admin.list()).length, 0);
          assert.ok(
            (await Promise.all(owner.monitors)).every(
              (value) => value === 'REAPED',
            ),
            'Unknown original monitor cannot authorize fixture removal.',
          );
        } finally {
          await admin.close();
        }
        const cache = join(owner.directory, 'state', 'null-netns');
        if (
          (await readFile('/proc/self/mountinfo', 'utf8'))
            .split('\n')
            .some((line) => line.split(' ')[4] === cache)
        ) {
          await execute('/usr/bin/umount', ['--', cache], { timeout: 5000 });
        }
      } catch (error) {
        errors.push(error);
      }
    }
    await inspector.close();
    if (errors.length) {
      throw new AggregateError(
        errors,
        `Native coordinator cleanup uncertain; retained ${workspace}`,
      );
    }
    const target = await realpath(workspace);
    assert.ok(
      dirname(target) === parent &&
        relative(parent, target).startsWith('airt-native-coordinator-') &&
        !relative(parent, target).includes(sep),
    );
    await rm(target, { recursive: true });
    cleaned = true;
  }

  return {
    createWorker,
    cleanup,
    assertClean,
    get starts() {
      return starts;
    },
    get onlyRecord() {
      const records = owners.flatMap((owner) => [...owner.records.values()]);
      assert.equal(records.length, 1);
      return records[0]!;
    },
    async status() {
      const owner = owners[0]!;
      const record = [...owner.records.values()][0]!;
      const admin = await RunscProcessClient.open(
        processOptions(owner.directory),
      );
      try {
        return checked(record, await admin.readState(record));
      } finally {
        await admin.close();
      }
    },
  };
}
