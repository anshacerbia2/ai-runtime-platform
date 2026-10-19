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
async function command(binary, args) {
  return execute(binary, args, {
    env: childEnv,
    timeout: 5000,
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
const root = join(workspace, 'state');
await mkdir(root, { mode: 0o700 });
const hostCanary = join(workspace, 'host-only-canary');
await writeFile(hostCanary, 'host-only-probe-file', { mode: 0o600 });
const fixtures = [];
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
  assertFixtureState(result, fixture.identity, fixture.bundle);
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
  await writeFile(
    join(bundle, 'config.json'),
    JSON.stringify(fixtureSpec(identity, mode)),
    { mode: 0o600 },
  );
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
async function start(fixture) {
  await runtime(['start', fixture.identity.sandboxId]);
}
async function remove(fixture, force = false) {
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
  const ordinary = await fixture('ordinary');
  await create(ordinary);
  await start(ordinary);
  assert.equal(
    JSON.parse((await runtime(['wait', ordinary.identity.sandboxId])).stdout)
      .exitStatus,
    0,
  );
  assert.equal((await state(ordinary)).status, 'stopped');
  await remove(ordinary);
  observations.push({ case: 'ordinary-exit', outcome: 'PASS' });
  console.log('gVisor fixture PASS: ordinary-exit');

  const graceful = await fixture('graceful');
  // Competing creates must leave one container and must not destroy the winner.
  const raced = await Promise.allSettled([create(graceful), create(graceful)]);
  assert.equal(
    raced.filter((result) => result.status === 'fulfilled').length,
    1,
  );
  await start(graceful);
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
    'set -eu',
    'test "$(/bin/busybox id -u)" = 65532',
    'test "$(/bin/busybox env | /bin/busybox grep -c AIR_RUNTIME_HOST_CANARY || true)" = 0',
    '! /bin/busybox grep -q "CapEff:.*[1-9a-f]" /proc/self/status',
    '/bin/busybox grep -q "NoNewPrivs:.*1" /proc/self/status',
    'test ! -r "$1"',
    'test ! -S /var/run/docker.sock',
    'test ! -S /run/containerd/containerd.sock',
    '! /bin/busybox sh -c "echo forbidden > /probe-root/write-test" 2>/dev/null',
    '/bin/busybox ln -s "$1" /tmp/escape',
    'test ! -r /tmp/escape',
    '! /bin/busybox dd if=/dev/zero of=/tmp/oversize bs=1048576 count=9 2>/dev/null',
    '/bin/busybox rm /tmp/oversize',
    'test -z "$(/bin/busybox ip route)"',
    'test -z "$(/bin/busybox ip -6 route)"',
    '! /bin/busybox timeout 2 /bin/busybox nc -w 1 169.254.169.254 80',
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
  await runtime(['kill', '--all', graceful.identity.sandboxId, 'TERM']);
  assert.equal(
    JSON.parse((await runtime(['wait', graceful.identity.sandboxId])).stdout)
      .exitStatus,
    143,
  );
  await remove(graceful);
  observations.push({
    case: 'duplicate-create-recovery-isolation-graceful-stop',
    outcome: 'PASS',
  });
  console.log(
    'gVisor fixture PASS: duplicate-create-recovery-isolation-graceful-stop',
  );

  const forced = await fixture('forced');
  await create(forced);
  await start(forced);
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
  assert.equal(
    JSON.parse((await runtime(['wait', forced.identity.sandboxId])).stdout)
      .exitStatus,
    137,
  );
  assert.equal((await state(forced)).status, 'stopped');
  await remove(forced);
  observations.push({
    case: 'term-ignoring-child-forced-stop-cgroup-empty',
    outcome: 'PASS',
  });
  console.log(
    'gVisor fixture PASS: term-ignoring-child-forced-stop-cgroup-empty',
  );
} catch (error) {
  failure = error;
}
async function cleanup() {
  const errors = [];
  for (const owned of fixtures.filter((item) => !item.deleted)) {
    try {
      await remove(owned, true);
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length) {
    throw new AggregateError(
      errors,
      `Cleanup unconfirmed; retained owned probe workspace ${workspace}`,
    );
  }
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
