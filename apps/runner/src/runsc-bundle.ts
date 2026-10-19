import { createHash } from 'node:crypto';
import {
  captureRunscIdentity,
  runscBindingAnnotation,
  runscSandboxId,
} from './runsc-sandbox-driver.js';
import type { SandboxIdentity } from './sandbox-supervisor.js';

export interface RootfsFile {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly executable: boolean;
}
export interface RootfsManifest {
  readonly format: 'ai-runtime-rootfs/v1';
  readonly architecture: 'x64' | 'arm64';
  readonly directories: readonly string[];
  readonly files: readonly RootfsFile[];
}
const unavailable = () => new Error('Runsc bundle unavailable.');
const exact = (value: object, keys: string[]) =>
  Object.keys(value).sort().join(',') === [...keys].sort().join(',');
export const rootfsDigestAnnotation = 'org.ai-runtime.rootfs.digest.v1';

export function validRootfsPath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= 240 &&
    /^[A-Za-z0-9_@+.,/-]+$/.test(value) &&
    value.split('/').length <= 8 &&
    value
      .split('/')
      .every((part) => part !== '' && part !== '.' && part !== '..')
  );
}

function normalize(input: RootfsManifest): RootfsManifest {
  if (
    !input ||
    !exact(input, ['format', 'architecture', 'directories', 'files']) ||
    input.format !== 'ai-runtime-rootfs/v1' ||
    !['x64', 'arm64'].includes(input.architecture) ||
    !Array.isArray(input.directories) ||
    !Array.isArray(input.files) ||
    input.directories.length > 256 ||
    input.files.length < 1 ||
    input.files.length > 256
  ) {
    throw unavailable();
  }
  const directories = [...input.directories].sort();
  if (
    directories.some((path) => !validRootfsPath(path)) ||
    !['dev', 'proc', 'tmp'].every((path) => directories.includes(path))
  ) {
    throw unavailable();
  }
  let bytes = 0;
  const files = input.files
    .map((file) => {
      if (
        !file ||
        !exact(file, ['path', 'bytes', 'sha256', 'executable']) ||
        !validRootfsPath(file.path) ||
        !Number.isSafeInteger(file.bytes) ||
        file.bytes < 0 ||
        file.bytes > 134217728 ||
        !/^[a-f0-9]{64}$/.test(file.sha256) ||
        typeof file.executable !== 'boolean'
      ) {
        throw unavailable();
      }
      bytes += file.bytes;
      return Object.freeze({
        path: file.path,
        bytes: file.bytes,
        sha256: file.sha256,
        executable: file.executable,
      });
    })
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const paths = [...directories, ...files.map((file) => file.path)];
  if (bytes > 268435456 || new Set(paths).size !== paths.length) {
    throw unavailable();
  }
  for (const path of paths) {
    const parts = path.split('/');
    for (let depth = 1; depth < parts.length; depth++) {
      if (!directories.includes(parts.slice(0, depth).join('/'))) {
        throw unavailable();
      }
    }
    if (/^(dev|proc|tmp)\//.test(path)) {
      throw unavailable();
    }
  }
  const manifest = Object.freeze({
    format: input.format,
    architecture: input.architecture,
    directories: Object.freeze(directories),
    files: Object.freeze(files),
  });
  if (Buffer.byteLength(JSON.stringify(manifest)) > 131072) {
    throw unavailable();
  }
  return manifest;
}

/** Internal file-tree format, not an OCI registry manifest/layer digest. */
export function rootfsManifestDigest(input: RootfsManifest): string {
  return `sha256:${createHash('sha256')
    .update(JSON.stringify(normalize(input)))
    .digest('hex')}`;
}
export function validateRootfsManifest(
  input: RootfsManifest,
  approvedDigest: string,
  architecture: string,
): RootfsManifest {
  const manifest = normalize(input);
  if (
    !/^sha256:[a-f0-9]{64}$/.test(approvedDigest) ||
    rootfsManifestDigest(manifest) !== approvedDigest ||
    manifest.architecture !== architecture
  ) {
    throw unavailable();
  }
  return manifest;
}

/** Fixed experimental isolation preset; no caller-supplied env, mounts or OCI fields. */
export function buildRunscSpec(
  identity: SandboxIdentity,
  command: readonly string[],
  rootfsDigest: string,
) {
  const binding = captureRunscIdentity(identity);
  if (
    !Array.isArray(command) ||
    command.length < 1 ||
    command.length > 32 ||
    command.some(
      (arg) =>
        typeof arg !== 'string' ||
        arg.includes('\0') ||
        Buffer.byteLength(arg) > 1024,
    ) ||
    Buffer.byteLength(command.join('\0')) > 8192 ||
    !command[0]?.startsWith('/') ||
    !validRootfsPath(command[0].slice(1)) ||
    !/^sha256:[a-f0-9]{64}$/.test(rootfsDigest)
  ) {
    throw unavailable();
  }
  return {
    ociVersion: '1.0.2',
    hostname: 'airt-sandbox',
    root: { path: 'rootfs', readonly: true },
    process: {
      terminal: false,
      user: { uid: 65532, gid: 65532, additionalGids: [] },
      args: [...command],
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
      cgroupsPath: `/${runscSandboxId(binding)}`,
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
    annotations: {
      [runscBindingAnnotation]: JSON.stringify(binding),
      [rootfsDigestAnnotation]: rootfsDigest,
    },
  };
}
