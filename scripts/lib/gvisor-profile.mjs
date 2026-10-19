import { isAbsolute } from 'node:path';

export const gvisorRelease = 'release-20261012.0';
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const bindingKey = 'org.ai-runtime.conformance.binding.v1';

/** A disposable experiment, never a production runner policy or fallback. */
export function assertProbeHost(host) {
  const kernel = /^(\d+)\.(\d+)\./.exec(host.release);
  if (
    host.platform !== 'linux' ||
    !['x64', 'arm64'].includes(host.arch) ||
    !kernel ||
    Number(kernel[1]) < 5 ||
    (Number(kernel[1]) === 5 && Number(kernel[2]) < 6) ||
    host.uid !== 0 ||
    host.disposable !== true
  ) {
    throw new Error(
      'Probe requires explicit disposable Linux 5.6+ x64/arm64 root host; no fallback.',
    );
  }
}

export function fixtureIdentity(id) {
  if (!UUID.test(id)) {
    throw new Error('Invalid fixture UUID.');
  }
  return Object.freeze({
    sandboxId: `airt-probe-${id}`,
    assignmentId: id,
    executionId: id,
    attemptId: id,
    runnerId: 'gvisor-fixture-runner',
    ownerSubject: 'gvisor-fixture-owner',
    bootId: id,
    generation: 1,
    epoch: 1,
  });
}

const scripts = {
  ordinary: 'exit 0',
  graceful: 'exec /bin/busybox sleep 300',
  forced:
    "trap '' TERM; /bin/busybox sh -c \"trap '' TERM; exec /bin/busybox sleep 300\" & wait",
};
export function fixtureSpec(identity, mode) {
  if (!Object.hasOwn(scripts, mode)) {
    throw new Error('Only fixed inert fixture programs are supported.');
  }
  return {
    ociVersion: '1.0.2',
    hostname: 'airt-sandbox-fixture',
    root: { path: 'rootfs', readonly: true },
    process: {
      terminal: false,
      user: { uid: 65532, gid: 65532, additionalGids: [] },
      args: ['/bin/busybox', 'sh', '-c', scripts[mode]],
      cwd: '/',
      env: ['PATH=/bin', 'LANG=C'],
      noNewPrivileges: true,
      capabilities: {
        bounding: [],
        effective: [],
        inheritable: [],
        permitted: [],
        ambient: [],
      },
      rlimits: [{ type: 'RLIMIT_NOFILE', hard: 64, soft: 64 }],
    },
    mounts: [
      {
        destination: '/proc',
        type: 'proc',
        source: 'proc',
        options: ['nosuid', 'noexec', 'nodev'],
      },
      {
        destination: '/dev',
        type: 'tmpfs',
        source: 'tmpfs',
        options: ['nosuid', 'noexec', 'mode=755', 'size=1048576'],
      },
      {
        destination: '/tmp',
        type: 'tmpfs',
        source: 'tmpfs',
        options: ['nosuid', 'noexec', 'nodev', 'mode=1777', 'size=8388608'],
      },
    ],
    linux: {
      namespaces: ['pid', 'network', 'mount', 'ipc', 'uts'].map((type) => ({
        type,
      })),
      cgroupsPath: `/${identity.sandboxId}`,
      resources: {
        memory: { limit: 268435456 },
        pids: { limit: 32 },
        cpu: { quota: 50000, period: 100000 },
      },
      maskedPaths: [
        '/proc/kcore',
        '/proc/keys',
        '/proc/timer_list',
        '/proc/sched_debug',
      ],
      readonlyPaths: [
        '/proc/sys',
        '/proc/sysrq-trigger',
        '/proc/irq',
        '/proc/bus',
      ],
    },
    annotations: { [bindingKey]: JSON.stringify(identity) },
  };
}

export function runscFlags(stateRoot) {
  if (!isAbsolute(stateRoot)) {
    throw new Error('Runtime state root must be absolute.');
  }
  return [`--root=${stateRoot}`, '--platform=systrap', '--network=none'];
}

export function assertFixtureState(state, identity, bundle) {
  if (
    state.id !== identity.sandboxId ||
    state.bundle !== bundle ||
    !['created', 'running', 'stopped', 'paused'].includes(state.status) ||
    state.annotations?.[bindingKey] !== JSON.stringify(identity)
  ) {
    throw new Error(
      'Runtime observation does not match the owned fixture binding.',
    );
  }
}
