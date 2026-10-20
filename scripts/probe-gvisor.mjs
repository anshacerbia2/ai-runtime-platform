import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  copyFile,
  chmod,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rm,
  rmdir,
  stat,
  writeFile,
} from 'node:fs/promises';
import { arch, platform, release, tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { promisify } from 'node:util';
import {
  assertFixtureState,
  assertProbeHost,
  fixtureIdentity,
  fixtureSpec,
  gvisorRelease,
  runscFlags,
  parseRunscList,
  assertLoopbackRoutes,
} from './lib/gvisor-profile.mjs';

const execute = promisify(execFile);
const [optIn, runtimePath, busyboxPath] = process.argv.slice(2);
assertProbeHost({
  platform: platform(),
  arch: arch(),
  release: release(),
  uid: process.geteuid?.(),
  disposable: optIn === '--disposable-linux-host',
});
assert.equal(
  arch(),
  'x64',
  'Disposable fixture currently has only an approved x64 BusyBox byte pin; no ARM64 fallback.',
);
const { RunscSandboxDriver, runscBindingAnnotation, runscSandboxId } =
  await import('../apps/runner/dist/runsc-sandbox-driver.js');
const { LocalSandboxSupervisor } =
  await import('../apps/runner/dist/sandbox-supervisor.js');
const { FileRunscLaunchStore } =
  await import('../apps/runner/dist/file-runsc-launch-store.js');
const { FileRunscBundleProducer } =
  await import('../apps/runner/dist/file-runsc-bundle-producer.js');
const { rootfsManifestDigest } =
  await import('../apps/runner/dist/runsc-bundle.js');
const { RunscProcessClient } =
  await import('../apps/runner/dist/runsc-process-client.js');
const { RunscCgroupInspector } =
  await import('../apps/runner/dist/runsc-cgroup-inspector.js');
const { probeOwnerCrash } = await import('./lib/gvisor-owner-crash-probe.mjs');
for (const file of [runtimePath, busyboxPath]) {
  assert.ok(
    typeof file === 'string' && isAbsolute(file),
    'Absolute runsc and static busybox paths required.',
  );
  const info = await stat(file);
  assert.ok(
    info.isFile() && info.uid === 0 && (info.mode & 0o022) === 0,
    'Probe binaries must be root-owned and not group/world writable.',
  );
}
const runsc = await realpath(runtimePath);
const busybox = await realpath(busyboxPath);
const childEnv = {
  PATH: '/usr/sbin:/usr/bin:/sbin:/bin',
  LANG: 'C',
  AIR_RUNTIME_HOST_CANARY: 'host-only-probe-canary',
};
async function command(binary, args, timeout = 5000) {
  return execute(binary, args, {
    env: childEnv,
    timeout,
    killSignal: 'SIGKILL',
    maxBuffer: 65536,
    windowsHide: true,
  });
}
const version = (await command(runsc, ['--version'])).stdout.trim();
assert.ok(
  version.includes(gvisorRelease),
  'Unexpected gVisor release; do not use latest or a fallback.',
);
const controllers = (
  await readFile('/sys/fs/cgroup/cgroup.controllers', 'utf8')
)
  .trim()
  .split(/\s+/);
assert.ok(
  ['cpu', 'memory', 'pids'].every((controller) =>
    controllers.includes(controller),
  ),
  'cgroup v2 CPU, memory and pids controllers are required.',
);
const binary = await readFile(busybox);
assert.equal(
  binary.subarray(0, 4).toString('hex'),
  '7f454c46',
  'Static busybox ELF required.',
);
// A dynamic binary would require a host loader/library mount, which this fixture forbids.
const linkage = await command('/usr/bin/ldd', [busybox]).catch((error) => ({
  stdout: error.stdout ?? '',
  stderr: error.stderr ?? '',
}));
assert.match(
  linkage.stdout + linkage.stderr,
  /not a dynamic executable|statically linked/,
);
const workspace = await mkdtemp(
  join(await realpath(tmpdir()), 'airt-gvisor-probe-'),
);
await chmod(workspace, 0o755); // Nonsecret host canary must be DAC-readable for a meaningful isolation probe.
const root = join(workspace, 'state');
await mkdir(root, { mode: 0o700 });
const hostCanary = join(workspace, 'host-only-canary');
await writeFile(hostCanary, 'host-only-probe-file', { mode: 0o644 });
const fixtures = [];
let launchStore;
let bundleProducer;
let processClient;
let cgroupInspector;
const additionalCleanup = [];
const driverBundles = join(workspace, 'driver-bundles');
const observations = [];
const report = {
  format: 'ai-runtime-gvisor-conformance/v1',
  gvisorRelease,
  version,
  host: { platform: platform(), arch: arch(), kernel: release(), controllers },
  fingerprints: {
    runsc: createHash('sha256')
      .update(await readFile(runsc))
      .digest('hex'),
    busybox: createHash('sha256').update(binary).digest('hex'),
  },
  policy: {
    platform: 'systrap',
    network: 'none',
    uid: 65532,
    memoryBytes: 268435456,
    pids: 32,
    cpuQuota: '50000/100000',
    tmpBytes: 8388608,
  },
  observations,
};
async function runtime(args) {
  return command(runsc, [...runscFlags(root), ...args]);
}
async function state(fixture) {
  const result = JSON.parse(
    (await runtime(['state', fixture.identity.sandboxId])).stdout,
  );
  if (fixture.driverBinding) {
    assert.equal(result.id, fixture.identity.sandboxId);
    assert.equal(result.bundle, fixture.bundle);
    assert.ok(
      ['created', 'running', 'stopped', 'paused'].includes(result.status),
    );
    assert.equal(
      result.annotations?.[runscBindingAnnotation],
      JSON.stringify(fixture.driverBinding),
    );
  } else {
    assertFixtureState(result, fixture.identity, fixture.bundle);
  }
  return result;
}
async function until(predicate) {
  const end = performance.now() + 5000;
  while (!(await predicate())) {
    assert.ok(
      performance.now() < end,
      'Fixture observation deadline exceeded.',
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
async function cgroupProcesses(directory, depth = 0) {
  assert.ok(depth <= 4, 'Unexpected cgroup depth.');
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
  assert.ok(entries.length < 128, 'Unexpected cgroup size.');
  let processes;
  try {
    processes = await readFile(join(directory, 'cgroup.procs'), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      return []; // The already-deleted owned cgroup can disappear during observation.
    }
    throw error;
  }
  const pids = processes.trim().split(/\s+/).filter(Boolean);
  for (const entry of entries.filter((entry) => entry.isDirectory())) {
    pids.push(
      ...(await cgroupProcesses(join(directory, entry.name), depth + 1)),
    );
  }
  return [...new Set(pids)];
}
async function fixture(mode) {
  const identity = fixtureIdentity(randomUUID());
  const bundle = join(workspace, identity.sandboxId);
  await mkdir(join(bundle, 'rootfs', 'bin'), { recursive: true, mode: 0o755 });
  for (const directory of ['tmp', 'proc', 'dev']) {
    await mkdir(join(bundle, 'rootfs', directory), { mode: 0o755 });
  }
  const writableProbe = join(bundle, 'rootfs', 'probe-root');
  await mkdir(writableProbe);
  await chmod(writableProbe, 0o777); // Deliberately writable DAC; the read-only mount must deny writes.
  await copyFile(busybox, join(bundle, 'rootfs', 'bin', 'busybox'));
  assert.equal(
    createHash('sha256')
      .update(await readFile(join(bundle, 'rootfs', 'bin', 'busybox')))
      .digest('hex'),
    report.fingerprints.busybox,
  );
  const spec = fixtureSpec(identity, mode);
  await writeFile(join(bundle, 'config.json'), JSON.stringify(spec), {
    mode: 0o600,
  });
  const result = {
    identity,
    bundle,
    cgroup: join('/sys/fs/cgroup', identity.sandboxId),
    deleted: false,
  };
  fixtures.push(result); // Register cleanup before the first possibly ambiguous create.
  return result;
}
async function create(fixture) {
  // Guest stdio outlives `create`; regular files avoid pipe-EOF waits on a live sandbox.
  const logPath = join(fixture.bundle, 'create.log');
  const log = await open(logPath, 'a', 0o600);
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(
        runsc,
        [
          ...runscFlags(root),
          'create',
          '--bundle',
          fixture.bundle,
          fixture.identity.sandboxId,
        ],
        {
          env: childEnv,
          stdio: ['ignore', log.fd, log.fd],
          timeout: 5000,
          killSignal: 'SIGKILL',
        },
      );
      child.once('error', reject);
      child.once('close', (code, signal) =>
        code === 0
          ? resolve()
          : reject(new Error(`Fixture create failed (${code ?? signal}).`)),
      );
    });
  } catch (error) {
    const bytes = Buffer.alloc(65536);
    const input = await open(logPath, 'r');
    try {
      const { bytesRead } = await input.read(bytes, 0, bytes.length, 0);
      throw new Error(
        `${error.message}\n${bytes.subarray(0, bytesRead).toString('utf8')}`,
        { cause: error },
      );
    } finally {
      await input.close();
    }
  } finally {
    await log.close();
  }
  assert.equal((await state(fixture)).status, 'created');
}
function attachedRun(fixture) {
  // Retain the parent/waiter: a later detached `wait` can lose fast-exit status.
  fixture.completion = command(
    runsc,
    [
      ...runscFlags(root),
      'run',
      '--bundle',
      fixture.bundle,
      fixture.identity.sandboxId,
    ],
    15000,
  ).then(
    (result) => ({ code: 0, result }),
    (error) => ({
      code:
        !error.killed && !error.signal && typeof error.code === 'number'
          ? error.code
          : null,
      error,
    }),
  );
}
async function observedExit(fixture, expected) {
  const result = await fixture.completion;
  assert.equal(result.code, expected, result.error?.message);
}
async function running(fixture) {
  await until(async () => {
    const listed = parseRunscList(
      (await runtime(['list', '--format=json'])).stdout,
    );
    return listed.some(
      (row) =>
        row.id === fixture.identity.sandboxId && row.status === 'running',
    );
  });
  assert.equal((await state(fixture)).status, 'running');
}
async function remove(fixture, force = false) {
  await fixture.beforeRemove?.();
  await runtime([
    'delete',
    ...(force ? ['--force'] : []),
    fixture.identity.sandboxId,
  ]);
  await until(async () => (await cgroupProcesses(fixture.cgroup)).length === 0);
  const remaining = parseRunscList(
    (await runtime(['list', '--format=json'])).stdout,
  );
  assert.ok(remaining.every((row) => row.id !== fixture.identity.sandboxId));
  if (fixture.driverBinding) {
    await until(() => cgroupInspector.empty(fixture.driverBinding));
  }
  await fixture.reapMonitor?.();
  fixture.deleted = true;
}
async function caps(fixture) {
  assert.equal(
    (await readFile(join(fixture.cgroup, 'memory.max'), 'utf8')).trim(),
    '268435456',
  );
  assert.equal(
    (await readFile(join(fixture.cgroup, 'pids.max'), 'utf8')).trim(),
    '32',
  );
  assert.equal(
    (await readFile(join(fixture.cgroup, 'cpu.max'), 'utf8')).trim(),
    '50000 100000',
  );
  assert.ok((await cgroupProcesses(fixture.cgroup)).length > 0);
}

let failure;
try {
  assert.equal(
    report.fingerprints.busybox,
    'dbac288c29ba568459550a2da9e7ae0ded6b1fc728ee9fad3044c44e62d6ac14',
  );
  const ordinary = await fixture('ordinary');
  attachedRun(ordinary);
  await observedExit(ordinary, 0);
  await remove(ordinary, true);
  observations.push({ case: 'ordinary-exit', outcome: 'PASS' });
  console.log('gVisor fixture PASS: ordinary-exit');

  const duplicateCreate = await fixture('graceful');
  // Competing creates must leave one container and must not destroy the winner.
  const raced = await Promise.allSettled([
    create(duplicateCreate),
    create(duplicateCreate),
  ]);
  assert.equal(
    raced.filter((result) => result.status === 'fulfilled').length,
    1,
  );
  assert.equal((await state(duplicateCreate)).status, 'created');
  await remove(duplicateCreate);
  observations.push({
    case: 'duplicate-create-one-owned-container',
    outcome: 'PASS',
  });
  console.log('gVisor fixture PASS: duplicate-create-one-owned-container');

  const graceful = await fixture('graceful');
  attachedRun(graceful);
  await running(graceful);
  await caps(graceful);
  const recovered = await state(graceful); // Each command is a fresh OS process.
  assert.equal(recovered.status, 'running');
  assert.throws(() =>
    assertFixtureState(
      recovered,
      { ...graceful.identity, bootId: randomUUID() },
      graceful.bundle,
    ),
  );
  const duplicate = await runtime(['start', graceful.identity.sandboxId]).then(
    () => true,
    () => false,
  );
  assert.equal(
    duplicate,
    false,
    'A repeated start must not execute a second program.',
  );
  assert.equal((await state(graceful)).status, 'running');
  const inspection = [
    'set -eux', // Fixed synthetic fixture only: retain the exact failing assertion in CI.
    'test "$(/bin/busybox id -u)" = 65532',
    'test "$(/bin/busybox env | /bin/busybox grep -c AIR_RUNTIME_HOST_CANARY || true)" = 0',
    '/bin/busybox grep -Eq "^CapEff:[[:space:]]*0+$" /proc/self/status',
    '/bin/busybox grep -Eq "^NoNewPrivs:[[:space:]]*1$" /proc/self/status',
    'test ! -r "$1"',
    'test ! -S /var/run/docker.sock',
    'test ! -S /run/containerd/containerd.sock',
    '! /bin/busybox sh -c "echo forbidden > /probe-root/write-test" 2>/dev/null',
    '/bin/busybox ln -s "$1" /tmp/escape',
    'test ! -r /tmp/escape',
    '! /bin/busybox dd if=/dev/zero of=/tmp/oversize bs=1048576 count=9 2>/dev/null',
    'test "$(/bin/busybox stat -c %s /tmp/oversize)" -ge 7340032',
    'test "$(/bin/busybox stat -c %s /tmp/oversize)" -le 8388608',
    '/bin/busybox rm /tmp/oversize',
    'if network=$(/bin/busybox timeout 2 /bin/busybox nc -w 1 169.254.169.254 80 2>&1); then exit 1; fi',
    'echo "$network" | /bin/busybox grep -q "Network is unreachable"',
    'echo ISOLATION_OK',
  ].join('\n');
  const isolated = await runtime([
    'exec',
    '--user',
    '65532:65532',
    graceful.identity.sandboxId,
    '/bin/busybox',
    'sh',
    '-c',
    inspection,
    'fixture',
    hostCanary,
  ]);
  assert.equal(isolated.stdout.trim(), 'ISOLATION_OK');
  for (const family of ['-4', '-6']) {
    const routes = await runtime([
      'exec',
      graceful.identity.sandboxId,
      '/bin/busybox',
      'ip',
      family,
      'route',
    ]);
    assertLoopbackRoutes(routes.stdout);
  }
  await runtime(['kill', '--all', graceful.identity.sandboxId, 'TERM']);
  await observedExit(graceful, 143);
  await remove(graceful, true);
  observations.push({
    case: 'duplicate-start-recovery-isolation-graceful-stop',
    outcome: 'PASS',
  });
  console.log(
    'gVisor fixture PASS: duplicate-start-recovery-isolation-graceful-stop',
  );

  const forced = await fixture('forced');
  attachedRun(forced);
  await running(forced);
  const processes = async () =>
    JSON.parse(
      (await runtime(['ps', '--format=json', forced.identity.sandboxId]))
        .stdout,
    );
  await until(async () => (await processes()).length >= 2);
  await runtime(['kill', '--all', forced.identity.sandboxId, 'TERM']);
  assert.equal(
    (await state(forced)).status,
    'running',
    'TERM ACK cannot certify termination.',
  );
  assert.ok((await processes()).length >= 2);
  await runtime(['kill', '--all', forced.identity.sandboxId, 'KILL']);
  await observedExit(forced, 137);
  await remove(forced, true);
  observations.push({
    case: 'term-ignoring-child-forced-stop-cgroup-empty',
    outcome: 'PASS',
  });
  console.log(
    'gVisor fixture PASS: term-ignoring-child-forced-stop-cgroup-empty',
  );

  // Independently pin fixture executable bytes. This is not a production release
  // approval resolver; an Ubuntu package change requires explicit pin review.
  await mkdir(driverBundles, { mode: 0o700 });
  const imageRoot = join(workspace, 'approved-rootfs');
  await mkdir(imageRoot, { mode: 0o700 });
  for (const name of ['bin', 'dev', 'proc', 'tmp']) {
    await mkdir(join(imageRoot, name), { mode: 0o700 });
  }
  await copyFile(busybox, join(imageRoot, 'bin/busybox'));
  await chmod(join(imageRoot, 'bin/busybox'), 0o555);
  const invalidExecutable = Buffer.from(
    'approved fixture with invalid executable format\n',
  );
  await writeFile(
    join(imageRoot, 'bin/invalid-executable'),
    invalidExecutable,
    { mode: 0o555 },
  );
  for (const name of ['bin', 'dev', 'proc', 'tmp']) {
    await chmod(join(imageRoot, name), 0o555);
  }
  const manifest = {
    format: 'ai-runtime-rootfs/v1',
    architecture: arch(),
    directories: ['bin', 'dev', 'proc', 'tmp'],
    files: [
      {
        path: 'bin/busybox',
        bytes: binary.length,
        sha256: report.fingerprints.busybox,
        executable: true,
      },
      {
        path: 'bin/invalid-executable',
        bytes: invalidExecutable.length,
        sha256: createHash('sha256').update(invalidExecutable).digest('hex'),
        executable: true,
      },
    ],
  };
  const programs = Object.fromEntries(
    ['ordinary', 'graceful', 'forced'].map((mode) => [
      mode,
      fixtureSpec(fixtureIdentity(randomUUID()), mode).process.args,
    ]),
  );
  programs['startup-failure'] = ['/bin/invalid-executable'];
  const producerOptions = {
    imageRoot,
    bundleRoot: driverBundles,
    manifest,
    approvedRootfsDigest: rootfsManifestDigest(manifest),
    programs,
  };
  bundleProducer = await FileRunscBundleProducer.open(producerOptions);
  report.rootfsApproval = {
    format: manifest.format,
    digest: producerOptions.approvedRootfsDigest,
    scope: 'pinned inert fixture only',
  };
  const reservations = join(workspace, 'driver-reservations');
  await mkdir(reservations, { mode: 0o700 });
  const storeOptions = {
    directory: reservations,
    bundleRoot: driverBundles,
    maxRecords: 256,
  };
  launchStore = await FileRunscLaunchStore.open(storeOptions);
  const processOptions = {
    executable: runsc,
    approvedExecutableSha256:
      '56996c546dbafd5716e1d09e307a131d97eb3b6483c22a1178631751f3e0392f',
    stateRoot: root,
    bundleRoot: driverBundles,
    commandTimeoutMs: 5000,
    runTimeoutMs: 15000,
  };
  processClient = await RunscProcessClient.open(processOptions);
  cgroupInspector = await RunscCgroupInspector.open();
  let driverMode = 'graceful';
  let starts = 0;
  const owned = (record) => {
    const found = fixtures.find(
      (item) => item.identity.sandboxId === record.sandboxId,
    );
    assert.ok(found, 'Driver may only address a fixture owned by this probe.');
    return found;
  };
  const lookup = async (id) => (await launchStore.lookup(id))?.record ?? null;
  const host = {
    lookup,
    async reserve(identity, id) {
      const previous = await lookup(id);
      if (previous) {
        return { record: previous, fresh: false };
      }
      if (
        launchStore.recoveryRequired ||
        bundleProducer.recoveryRequired ||
        processClient.recoveryRequired ||
        cgroupInspector.recoveryRequired
      ) {
        throw new Error('Host recovery required.');
      }
      await bundleProducer.prepare(identity, driverMode);
      const verified = await bundleProducer.verify(identity, driverMode);
      assert.equal(verified.record.sandboxId, id);
      const item = {
        identity: { ...identity, sandboxId: id },
        driverBinding: identity,
        bundle: verified.record.bundle,
        cgroup: join('/sys/fs/cgroup', id),
        deleted: false,
      };
      fixtures.push(item);
      const saved = await launchStore.reserve(
        verified.record,
        verified.configDigest,
      );
      return { record: saved.reservation.record, fresh: saved.fresh };
    },
    start(record, guard) {
      const item = owned(record);
      starts++;
      const monitor = processClient.run(record, guard); // Final guarded OS spawn.
      item.completion = monitor.finished.then((result) => ({
        code: result.code,
      }));
      let settled = false;
      let exitCode = null;
      const finished = monitor.finished.then((result) => {
        settled = true;
        exitCode = result.code;
        return result.state;
      });
      const ready = (async () => {
        // Do not abandon creation on an observation deadline: stop must retain
        // the handle until the attached monitor is reaped or creation is visible.
        while (!settled) {
          try {
            const listed = await processClient.list();
            const row = listed.find((entry) => entry.id === record.sandboxId);
            if (row?.status === 'running') {
              const observed = await processClient.readState(record);
              assert.equal(observed.id, record.sandboxId);
              assert.equal(observed.bundle, record.bundle);
              assert.equal(observed.status, 'running');
              assert.equal(
                observed.annotations?.[runscBindingAnnotation],
                JSON.stringify(record.identity),
              );
              return;
            }
          } catch {
            // A fast exit can remove state between list and state. The bounded
            // original monitor remains responsible for creation/exit observation.
          }
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        // Numeric runsc failure can be a pre-start CLI error, not guest startup.
        // Only zero is accepted for a fast exit without a running observation.
        if (exitCode !== 0) {
          throw new Error('Runtime startup unconfirmed.');
        }
      })();
      return { ready, finished };
    },
    async state(record) {
      const rows = await processClient.list();
      if (!rows.some((row) => row.id === record.sandboxId)) {
        return null;
      }
      return processClient.readState(record);
    },
    async signalAll(record, signal) {
      await processClient.signalAll(record, signal);
    },
    async destroy(record) {
      await processClient.destroy(record);
    },
    async cgroupEmpty(record) {
      owned(record);
      return cgroupInspector.empty(record.identity);
    },
  };
  const binding = () => ({
    assignmentId: randomUUID(),
    executionId: randomUUID(),
    attemptId: randomUUID(),
    runnerId: 'driver-fixture-runner',
    ownerSubject: 'driver-fixture-owner',
    bootId: randomUUID(),
    generation: 1,
    epoch: 1,
  });
  const driver = new RunscSandboxDriver(host);
  const supervisor = new LocalSandboxSupervisor(driver);
  const grant = binding();
  const [handle, replay] = await Promise.all([
    supervisor.start(grant),
    supervisor.start({ ...grant }),
  ]);
  assert.equal(handle, replay);
  assert.equal(starts, 1);
  // Fresh driver/supervisor reads the durable marker and the actual runtime state.
  // This models local supervisor replacement, NOT a hard process/node crash.
  await assert.rejects(
    new RunscSandboxDriver(host).recover({ ...grant, bootId: randomUUID() }),
    /identity/,
  );
  const recoveredDriver = new RunscSandboxDriver(host);
  const recoveredHandle = await recoveredDriver.launch(grant);
  assert.equal(starts, 1, 'Recovery must never make a second runtime call.');
  assert.equal(await recoveredHandle.inspect(), 'RUNNING');
  const restarted = new LocalSandboxSupervisor(recoveredDriver);
  assert.equal((await restarted.stop(grant)).state, 'TERMINATED');
  await observedExit(owned(await lookup(runscSandboxId(grant))), 143);
  await until(async () => (await handle.inspect()) === 'EXITED');
  await new RunscSandboxDriver(host).launch(grant);
  assert.equal(starts, 1, 'Deleted runtime plus retained marker cannot rerun.');
  const missing = (await new RunscSandboxDriver(host).recover(grant)).handle;
  assert.equal(
    await missing.inspect(),
    'UNKNOWN',
    'Fresh monitor-less absence is not stop proof.',
  );
  observations.push({
    case: 'driver-supervisor-recovery-no-rerun-graceful',
    outcome: 'PASS',
  });
  console.log(
    'gVisor driver PASS: supervisor recovery, graceful stop, no rerun',
  );

  driverMode = 'forced';
  const forcedGrant = binding();
  const forcedHandle = await supervisor.start(forcedGrant);
  const forcedRecord = await lookup(runscSandboxId(forcedGrant));
  await until(
    async () =>
      JSON.parse(
        (await runtime(['ps', '--format=json', forcedRecord.sandboxId])).stdout,
      ).length >= 2,
  );
  await forcedHandle.requestStop();
  assert.equal(
    await forcedHandle.inspect(),
    'RUNNING',
    'Driver cannot turn TERM ACK into exit proof.',
  );
  assert.equal((await supervisor.stop(forcedGrant)).state, 'TERMINATED');
  await observedExit(owned(forcedRecord), 137);
  observations.push({
    case: 'driver-supervisor-child-forced-stop',
    outcome: 'PASS',
  });
  console.log(
    'gVisor driver PASS: TERM-ignoring child, forced stop and subtree inspection',
  );

  driverMode = 'ordinary';
  const ordinaryGrant = binding();
  const ordinaryHandle = await supervisor.start(ordinaryGrant);
  await observedExit(owned(await lookup(runscSandboxId(ordinaryGrant))), 0);
  await until(async () => (await ordinaryHandle.inspect()) === 'EXITED');
  observations.push({ case: 'driver-fast-ordinary-exit', outcome: 'PASS' });
  console.log('gVisor driver PASS: fast ordinary exit with attached monitor');

  driverMode = 'startup-failure';
  const failedGrant = binding();
  await assert.rejects(supervisor.start(failedGrant), /startup unconfirmed/);
  assert.deepEqual(await supervisor.stop(failedGrant), {
    state: 'UNCONFIRMED',
    method: null,
  });
  const failedRecord = await lookup(runscSandboxId(failedGrant));
  const failureResult = await owned(failedRecord).completion;
  assert.ok(failureResult.code !== null && failureResult.code !== 0);
  await assert.rejects(driver.launch(failedGrant), /startup unconfirmed/);
  const failedHandle = (await driver.recover(failedGrant)).handle;
  // Drain any cleanup already queued by supervisor stop before host teardown.
  await failedHandle.inspect();
  assert.equal(
    starts,
    4,
    'Failed startup cannot cause another runtime launch.',
  );
  observations.push({
    case: 'driver-unconfirmed-startup-retained-cleanup',
    outcome: 'PASS',
  });
  console.log(
    'gVisor driver PASS: failed startup retains recovery without rerun or success evidence',
  );
  // All attached monitors are reaped and all owned trees inspected before
  // releasing storage ownership. Reopening never grants fresh work implicitly.
  for (const item of fixtures.filter((entry) =>
    entry.identity.sandboxId.startsWith('airt-runner-'),
  )) {
    await item.completion;
    await remove(item, true);
  }
  await processClient.close();
  processClient = await RunscProcessClient.open({
    ...processOptions,
    runTimeoutMs: 1000,
  });
  driverMode = 'forced';
  const deadlineGrant = binding();
  const deadlineReservation = await host.reserve(
    deadlineGrant,
    runscSandboxId(deadlineGrant),
  );
  assert.equal(deadlineReservation.fresh, true);
  const deadlineMonitor = host.start(deadlineReservation.record);
  // Startup can race the configured deadline. Both outcomes retain the same
  // original monitor; neither timeout nor failed readiness proves guest exit.
  const deadlineReady = deadlineMonitor.ready.catch(() => {});
  assert.equal(await deadlineMonitor.finished, 'LOST');
  await deadlineReady;
  assert.equal(processClient.recoveryRequired, true);
  const replayedDeadline = await new RunscSandboxDriver(host).launch(
    deadlineGrant,
  );
  assert.equal(starts, 5, 'Lost monitor cannot cause another attached run.');
  const deadlineState = await host.state(deadlineReservation.record);
  const inspectionBeforeCleanup = await replayedDeadline.inspect();
  if (deadlineState === null) {
    assert.equal(
      inspectionBeforeCleanup,
      'UNKNOWN',
      'Monitor-less absence is not termination proof.',
    );
  }
  // A still-visible started binding may instead permit independent driver
  // cleanup. In either case the lost original monitor never becomes REAPED.
  await remove(owned(deadlineReservation.record), true);
  assert.equal(await deadlineMonitor.finished, 'LOST');
  const deniedAfterLoss = binding();
  await assert.rejects(
    host.reserve(deniedAfterLoss, runscSandboxId(deniedAfterLoss)),
    /recovery/,
  );
  assert.equal(await launchStore.lookup(runscSandboxId(deniedAfterLoss)), null);
  observations.push({
    case: 'native-monitor-deadline-no-rerun-no-termination-inference',
    outcome: 'PASS',
  });
  console.log(
    'gVisor native process PASS: deadline remains LOST, no rerun or fresh reservation, explicit subtree cleanup',
  );
  const tamperedGrant = binding();
  const tampered = await bundleProducer.prepare(tamperedGrant, 'ordinary');
  const changedBinary = Buffer.from(binary);
  changedBinary[0] ^= 1;
  const changedPath = join(tampered.record.bundle, 'rootfs/bin/busybox');
  await chmod(changedPath, 0o755);
  await writeFile(changedPath, changedBinary);
  await chmod(changedPath, 0o555);
  await assert.rejects(bundleProducer.verify(tamperedGrant, 'ordinary'));
  assert.equal(await launchStore.lookup(tampered.record.sandboxId), null);
  assert.equal(
    starts,
    5,
    'Tampered bundle cannot reach reservation or runtime dispatch.',
  );
  observations.push({
    case: 'approved-rootfs-tamper-denied-before-reservation',
    outcome: 'PASS',
  });
  console.log(
    'gVisor driver PASS: pinned rootfs copy rejects byte tampering before reservation/dispatch',
  );
  await bundleProducer.close();
  bundleProducer = await FileRunscBundleProducer.open(producerOptions);
  assert.equal(bundleProducer.recoveryRequired, true);
  await bundleProducer.verify(grant, 'graceful');
  await assert.rejects(
    bundleProducer.prepare(binding(), 'ordinary'),
    /recovery/,
  );
  await launchStore.close();
  launchStore = await FileRunscLaunchStore.open(storeOptions);
  assert.equal(launchStore.recoveryRequired, true);
  await new RunscSandboxDriver(host).launch(grant);
  assert.equal(starts, 5, 'Disk store reopen cannot cause a second launch.');
  const newGrant = binding();
  const newId = runscSandboxId(newGrant);
  await assert.rejects(
    launchStore.reserve(
      {
        identity: newGrant,
        sandboxId: newId,
        bundle: join(driverBundles, newId),
      },
      `sha256:${'0'.repeat(64)}`,
    ),
    /recovery/,
  );
  observations.push({
    case: 'file-store-reopen-no-rerun-no-fresh-work',
    outcome: 'PASS',
  });
  console.log(
    'gVisor driver PASS: real reservation store reopen blocks fresh work and rerun',
  );
  // A separate owned kernel hierarchy proves the parent's direct PID list is
  // insufficient when its only live task is in a nested child cgroup.
  const nestedBinding = binding();
  const nestedRoot = join('/sys/fs/cgroup', runscSandboxId(nestedBinding));
  const nestedChild = join(nestedRoot, 'owned-child');
  let nestedRootCreated = false;
  let nestedChildCreated = false;
  let sleeper;
  let sleeperExit;
  const cleanNested = async () => {
    if (sleeper && sleeper.exitCode === null && sleeper.signalCode === null) {
      sleeper.kill('SIGKILL');
    }
    await sleeperExit;
    if (nestedRootCreated) {
      await until(() => cgroupInspector.empty(nestedBinding));
    }
    if (nestedChildCreated) {
      await rmdir(nestedChild);
      nestedChildCreated = false;
    }
    if (nestedRootCreated) {
      await rmdir(nestedRoot);
      nestedRootCreated = false;
    }
  };
  additionalCleanup.push(cleanNested);
  await mkdir(nestedRoot);
  nestedRootCreated = true;
  await writeFile(join(nestedRoot, 'memory.max'), '134217728');
  await writeFile(join(nestedRoot, 'pids.max'), '16');
  await writeFile(join(nestedRoot, 'cpu.max'), '50000 100000');
  await mkdir(nestedChild);
  nestedChildCreated = true;
  // Trusted short-lived host test helper, never an agent/plugin execution path.
  sleeper = spawn('/bin/sleep', ['30'], { env: childEnv, stdio: 'ignore' });
  sleeperExit = new Promise((resolve, reject) => {
    sleeper.once('error', reject);
    sleeper.once('exit', resolve);
  });
  assert.ok(sleeper.pid);
  await writeFile(join(nestedChild, 'cgroup.procs'), String(sleeper.pid));
  assert.equal(
    (await readFile(join(nestedRoot, 'cgroup.procs'), 'utf8')).trim(),
    '',
  );
  assert.equal(await cgroupInspector.empty(nestedBinding), false);
  await cleanNested();
  observations.push({
    case: 'native-cgroup-detects-nested-process-with-empty-parent',
    outcome: 'PASS',
  });
  console.log(
    'gVisor kernel PASS: native inspector detects populated descendant with empty parent PID list',
  );
  await probeOwnerCrash({
    workspace,
    processOptions,
    producerOptions,
    identity: binding(),
    inspector: cgroupInspector,
    fixtures,
    runtime,
    until,
  });
  observations.push({
    case: 'live-owner-sigkill-stale-lock-no-takeover-no-rerun',
    outcome: 'PASS',
  });
  console.log(
    'gVisor owner crash PASS: SIGKILL with live sandbox, unchanged durable lock denies takeover before and after explicit cleanup',
  );
} catch (error) {
  failure = error;
}
async function cleanup() {
  const errors = [];
  for (const cleanup of additionalCleanup) {
    try {
      await cleanup();
    } catch (error) {
      errors.push(error);
    }
  }
  for (const owned of fixtures.filter((item) => !item.deleted)) {
    try {
      await remove(owned, true);
    } catch (error) {
      errors.push(error);
    }
  }
  await Promise.all(fixtures.map((item) => item.completion));
  if (errors.length) {
    throw new AggregateError(
      errors,
      `Cleanup unconfirmed; retained owned probe workspace ${workspace}`,
    );
  }
  await bundleProducer?.close();
  await processClient?.close();
  await cgroupInspector?.close();
  await launchStore?.close();
  const expectedParent = await realpath(tmpdir());
  const cleanupTarget = await realpath(workspace);
  assert.ok(
    dirname(cleanupTarget) === expectedParent &&
      relative(expectedParent, cleanupTarget).startsWith(
        'airt-gvisor-probe-',
      ) &&
      !relative(expectedParent, cleanupTarget).includes(sep),
  );
  // Pinned runsc caches a bind-mounted empty network namespace inside its private root.
  // Only unmount that exact owned cache after all owned containers/cgroups are clean.
  const namespaceCache = join(cleanupTarget, 'state', 'null-netns');
  const mounted = (await readFile('/proc/self/mountinfo', 'utf8'))
    .split('\n')
    .some((line) => line.split(' ')[4] === namespaceCache);
  if (mounted) {
    await command('/usr/bin/umount', ['--', namespaceCache]);
  }
  await rm(cleanupTarget, { recursive: true });
}
try {
  await cleanup();
} catch (error) {
  throw new AggregateError(
    [...(failure ? [failure] : []), error],
    `Probe/cleanup failed; owned workspace ${workspace}`,
    { cause: error },
  );
}
if (failure) {
  throw failure;
}
console.log(JSON.stringify({ ...report, outcome: 'PASS' }, null, 2));
