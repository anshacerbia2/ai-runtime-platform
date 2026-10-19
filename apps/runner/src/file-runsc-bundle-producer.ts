import { constants, type Stats, type BigIntStats } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  lstat,
  mkdir,
  open,
  opendir,
  realpath,
  type FileHandle,
} from 'node:fs/promises';
import { posix } from 'node:path';
import {
  buildRunscSpec,
  validateRootfsManifest,
  type RootfsFile,
  type RootfsManifest,
} from './runsc-bundle.js';
import {
  captureRunscIdentity,
  runscSandboxId,
  type RunscLaunchRecord,
} from './runsc-sandbox-driver.js';
import type { SandboxIdentity } from './sandbox-supervisor.js';

export interface FileRunscBundleProducerOptions {
  imageRoot: string;
  bundleRoot: string;
  manifest: RootfsManifest;
  /** Trusted release approval input, never derived from caller-supplied content. */
  approvedRootfsDigest: string;
  /** Fixed host-owned launchers; requests cannot supply argv/env/OCI fields. */
  programs: Readonly<Record<string, readonly string[]>>;
}
export interface VerifiedRunscBundle {
  readonly record: RunscLaunchRecord;
  readonly configDigest: string;
  readonly rootfsDigest: string;
}
const unavailable = () => new Error('Runsc bundle unavailable.');
const anchor = (file: FileHandle) => `/proc/self/fd/${file.fd}`;
const owner = (info: Stats | BigIntStats) =>
  Number(info.uid) === process.geteuid?.();
const permissions = (info: Stats | BigIntStats, mode: number) =>
  owner(info) && (Number(info.mode) & 0o7777) === mode;
const canonical = (path: string) =>
  typeof path === 'string' &&
  path.length <= 2048 &&
  !path.includes('\0') &&
  posix.isAbsolute(path) &&
  posix.normalize(path) === path;
const hash = (bytes: Uint8Array) =>
  `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

async function directory(path: string, mode: number): Promise<FileHandle> {
  const file = await open(
    path,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  try {
    const info = await file.stat();
    if (!info.isDirectory() || !permissions(info, mode)) {
      throw unavailable();
    }
    return file;
  } catch (error) {
    await file.close();
    throw error;
  }
}
async function checkRoot(path: string, file: FileHandle): Promise<void> {
  const held = await file.stat({ bigint: true });
  const named = await lstat(path, { bigint: true });
  if (
    !held.isDirectory() ||
    !permissions(held, 0o700) ||
    !permissions(named, 0o700) ||
    named.isSymbolicLink() ||
    held.ino !== named.ino ||
    held.dev !== named.dev ||
    (await realpath(path)) !== path
  ) {
    throw unavailable();
  }
}
async function withParent<T>(
  root: FileHandle,
  path: string,
  mode: number,
  work: (parent: FileHandle, name: string) => Promise<T>,
): Promise<T> {
  const parts = path.split('/');
  let parent = root;
  let held: FileHandle | undefined;
  try {
    for (const part of parts.slice(0, -1)) {
      const child = await directory(posix.join(anchor(parent), part), mode);
      const previous = held;
      held = child;
      parent = child;
      await previous?.close();
    }
    return await work(parent, parts[parts.length - 1]!);
  } finally {
    await held?.close();
  }
}

/** File-only rootfs subset. No archive extraction, registry trust or runtime execution. */
export class FileRunscBundleProducer {
  private readonly known = new Set<string>();
  private readonly prepared = new Map<
    string,
    { binding: string; program: string; value: Promise<VerifiedRunscBundle> }
  >();
  private queue: Promise<unknown> = Promise.resolve();
  private pending = 0;
  private poisoned = false;
  private closing = false;
  private closed: Promise<void> | null = null;
  private recovered = false;
  private readonly files: Map<string, RootfsFile>;

  private constructor(
    private readonly options: FileRunscBundleProducerOptions,
    private readonly image: FileHandle,
    private readonly bundles: FileHandle,
  ) {
    this.files = new Map(
      options.manifest.files.map((file) => [file.path, file]),
    );
  }

  static async open(
    options: FileRunscBundleProducerOptions,
  ): Promise<FileRunscBundleProducer> {
    if (process.platform !== 'linux') {
      throw unavailable();
    }
    let image: FileHandle | undefined;
    let bundles: FileHandle | undefined;
    try {
      const manifest = validateRootfsManifest(
        options.manifest,
        options.approvedRootfsDigest,
        process.arch,
      );
      if (
        !canonical(options.imageRoot) ||
        !canonical(options.bundleRoot) ||
        options.imageRoot === options.bundleRoot ||
        options.imageRoot.startsWith(`${options.bundleRoot}/`) ||
        options.bundleRoot.startsWith(`${options.imageRoot}/`) ||
        !options.programs ||
        Object.keys(options.programs).length < 1 ||
        Object.keys(options.programs).length > 16
      ) {
        throw unavailable();
      }
      const programs: Record<string, readonly string[]> = Object.create(
        null,
      ) as Record<string, readonly string[]>;
      for (const [name, args] of Object.entries(options.programs)) {
        if (!/^[a-z][a-z0-9-]{0,31}$/.test(name)) {
          throw unavailable();
        }
        buildRunscSpec(
          {
            assignmentId: 'validation',
            executionId: 'validation',
            attemptId: 'validation',
            runnerId: 'validation',
            ownerSubject: 'validation',
            bootId: 'validation',
            generation: 1,
            epoch: 1,
          },
          args,
          options.approvedRootfsDigest,
        );
        if (
          !manifest.files.some(
            (file) => `/${file.path}` === args[0] && file.executable,
          )
        ) {
          throw unavailable();
        }
        programs[name] = Object.freeze([...args]);
      }
      const captured = Object.freeze({
        ...options,
        manifest,
        programs: Object.freeze(programs),
      });
      image = await directory(captured.imageRoot, 0o700);
      await checkRoot(captured.imageRoot, image);
      bundles = await directory(captured.bundleRoot, 0o700);
      await checkRoot(captured.bundleRoot, bundles);
      const producer = new FileRunscBundleProducer(captured, image, bundles);
      const entries = await opendir(anchor(bundles));
      for await (const entry of entries) {
        if (
          !/^airt-runner-[a-f0-9]{64}$/.test(entry.name) ||
          !entry.isDirectory() ||
          producer.known.size >= 256
        ) {
          throw unavailable();
        }
        const child = await directory(
          posix.join(anchor(bundles), entry.name),
          0o700,
        );
        await child.close();
        producer.known.add(entry.name);
      }
      producer.recovered = producer.known.size > 0;
      return producer;
    } catch {
      await Promise.allSettled([image?.close(), bundles?.close()]);
      throw unavailable();
    }
  }

  get recoveryRequired(): boolean {
    return this.recovered;
  }

  prepare(
    identity: SandboxIdentity,
    program: string,
  ): Promise<VerifiedRunscBundle> {
    let captured: SandboxIdentity;
    try {
      captured = captureRunscIdentity(identity);
      this.command(program);
    } catch {
      return Promise.reject(unavailable());
    }
    if (this.poisoned || this.closing) {
      return Promise.reject(unavailable());
    }
    if (this.recovered) {
      return Promise.reject(
        new Error('Runsc bundle recovery required before new preparation.'),
      );
    }
    const id = runscSandboxId(captured);
    const binding = JSON.stringify(captured);
    const previous = this.prepared.get(id);
    if (previous) {
      return previous.binding === binding && previous.program === program
        ? previous.value
        : Promise.reject(unavailable());
    }
    if (this.known.size >= 256) {
      return Promise.reject(new Error('Runsc bundle capacity exhausted.'));
    }
    this.known.add(id);
    const value = this.enqueue(() => this.materialize(captured, program));
    this.prepared.set(id, { binding, program, value });
    return value;
  }

  verify(
    identity: SandboxIdentity,
    program: string,
  ): Promise<VerifiedRunscBundle> {
    let captured: SandboxIdentity;
    try {
      captured = captureRunscIdentity(identity);
      this.command(program);
    } catch {
      return Promise.reject(unavailable());
    }
    if (!this.known.has(runscSandboxId(captured))) {
      return Promise.reject(unavailable());
    }
    return this.enqueue(async () => {
      const id = runscSandboxId(captured);
      const bundle = await directory(
        posix.join(anchor(this.bundles), id),
        0o700,
      );
      try {
        const entries = await opendir(anchor(bundle));
        const seen = new Set<string>();
        for await (const entry of entries) {
          if (
            !['rootfs', 'config.json', 'image-manifest.json'].includes(
              entry.name,
            ) ||
            seen.has(entry.name)
          ) {
            throw unavailable();
          }
          seen.add(entry.name);
        }
        if (seen.size !== 3) {
          throw unavailable();
        }
        const config = this.config(captured, program);
        await this.metadata(bundle, 'config.json', config);
        await this.metadata(
          bundle,
          'image-manifest.json',
          Buffer.from(JSON.stringify(this.options.manifest)),
        );
        const rootfs = await directory(
          posix.join(anchor(bundle), 'rootfs'),
          0o555,
        );
        try {
          await this.walk(rootfs, async (file, expected) =>
            this.contents(file, expected),
          );
        } finally {
          await rootfs.close();
        }
        return this.result(captured, config);
      } finally {
        await bundle.close();
      }
    });
  }

  close(): Promise<void> {
    if (!this.closed) {
      this.closing = true;
      this.closed = this.queue.then(async () => {
        const results = await Promise.allSettled([
          this.image.close(),
          this.bundles.close(),
        ]);
        if (results.some((result) => result.status === 'rejected')) {
          throw unavailable();
        }
      });
    }
    return this.closed;
  }

  private command(name: string): readonly string[] {
    const command = this.options.programs[name];
    if (!command || !Object.hasOwn(this.options.programs, name)) {
      throw unavailable();
    }
    return command;
  }
  private config(identity: SandboxIdentity, program: string): Buffer {
    const bytes = Buffer.from(
      JSON.stringify(
        buildRunscSpec(
          identity,
          this.command(program),
          this.options.approvedRootfsDigest,
        ),
      ),
    );
    if (bytes.length > 32768) {
      throw unavailable();
    }
    return bytes;
  }
  private result(
    identity: SandboxIdentity,
    config: Buffer,
  ): VerifiedRunscBundle {
    const sandboxId = runscSandboxId(identity);
    return Object.freeze({
      record: Object.freeze({
        identity,
        sandboxId,
        bundle: posix.join(this.options.bundleRoot, sandboxId),
      }),
      configDigest: hash(config),
      rootfsDigest: this.options.approvedRootfsDigest,
    });
  }
  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    if (this.closing || this.poisoned) {
      return Promise.reject(unavailable());
    }
    if (this.pending >= 4) {
      return Promise.reject(
        new Error('Runsc bundle intake capacity exhausted.'),
      );
    }
    this.pending++;
    const value = this.queue.then(async () => {
      if (this.poisoned) {
        throw unavailable();
      }
      try {
        await checkRoot(this.options.imageRoot, this.image);
        await checkRoot(this.options.bundleRoot, this.bundles);
        return await work();
      } catch {
        this.poisoned = true;
        throw unavailable();
      }
    });
    this.queue = value.catch(() => {});
    return value.finally(() => {
      this.pending--;
    });
  }

  private async materialize(
    identity: SandboxIdentity,
    program: string,
  ): Promise<VerifiedRunscBundle> {
    const id = runscSandboxId(identity);
    await mkdir(posix.join(anchor(this.bundles), id), { mode: 0o700 });
    const bundle = await directory(posix.join(anchor(this.bundles), id), 0o700);
    try {
      await mkdir(posix.join(anchor(bundle), 'rootfs'), { mode: 0o700 });
      const rootfs = await directory(
        posix.join(anchor(bundle), 'rootfs'),
        0o700,
      );
      try {
        for (const path of this.options.manifest.directories) {
          await withParent(rootfs, path, 0o700, async (parent, name) => {
            await mkdir(posix.join(anchor(parent), name), { mode: 0o700 });
          });
        }
        await this.walk(this.image, async (source, expected) =>
          withParent(rootfs, expected.path, 0o700, async (parent, name) => {
            const target = await open(
              posix.join(anchor(parent), name),
              constants.O_WRONLY |
                constants.O_CREAT |
                constants.O_EXCL |
                constants.O_NOFOLLOW,
              0o600,
            );
            try {
              await this.contents(source, expected, target);
              await target.chmod(expected.executable ? 0o555 : 0o444);
              await target.sync();
            } finally {
              await target.close();
            }
          }),
        );
        for (const path of [...this.options.manifest.directories].reverse()) {
          await withParent(rootfs, path, 0o700, async (parent, name) => {
            const child = await directory(
              posix.join(anchor(parent), name),
              0o700,
            );
            try {
              await child.chmod(0o555);
              await child.sync();
            } finally {
              await child.close();
            }
          });
        }
        await rootfs.chmod(0o555);
        await rootfs.sync();
      } finally {
        await rootfs.close();
      }
      const config = this.config(identity, program);
      await this.writeMetadata(
        bundle,
        'image-manifest.json',
        Buffer.from(JSON.stringify(this.options.manifest)),
      );
      await this.writeMetadata(bundle, 'config.json', config);
      await bundle.sync();
      await this.bundles.sync();
      return this.result(identity, config);
    } finally {
      await bundle.close();
    }
  }

  private async walk(
    root: FileHandle,
    visit: (file: FileHandle, expected: RootfsFile) => Promise<void>,
  ): Promise<void> {
    const seen = new Set<string>();
    const directories = new Set(this.options.manifest.directories);
    const walk = async (parent: FileHandle, prefix: string) => {
      const entries = await opendir(anchor(parent));
      for await (const entry of entries) {
        const path = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (
          seen.has(path) ||
          seen.size >= 512 ||
          (!directories.has(path) && !this.files.has(path))
        ) {
          throw unavailable();
        }
        seen.add(path);
        if (directories.has(path)) {
          if (!entry.isDirectory()) {
            throw unavailable();
          }
          const child = await directory(
            posix.join(anchor(parent), entry.name),
            0o555,
          );
          try {
            await walk(child, path);
          } finally {
            await child.close();
          }
        } else {
          if (!entry.isFile()) {
            throw unavailable();
          }
          const file = await open(
            posix.join(anchor(parent), entry.name),
            constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
          );
          try {
            await visit(file, this.files.get(path)!);
          } finally {
            await file.close();
          }
        }
      }
    };
    await walk(root, '');
    if (seen.size !== directories.size + this.files.size) {
      throw unavailable();
    }
  }

  private async contents(
    source: FileHandle,
    expected: RootfsFile,
    target?: FileHandle,
  ): Promise<void> {
    const inspect = async () => {
      const info = await source.stat();
      if (
        !info.isFile() ||
        info.nlink !== 1 ||
        info.size !== expected.bytes ||
        !permissions(info, expected.executable ? 0o555 : 0o444)
      ) {
        throw unavailable();
      }
    };
    await inspect();
    const digest = createHash('sha256');
    const bytes = Buffer.alloc(65536);
    let position = 0;
    while (position <= expected.bytes) {
      const { bytesRead } = await source.read(
        bytes,
        0,
        Math.min(bytes.length, expected.bytes - position + 1),
        position,
      );
      if (bytesRead === 0) {
        break;
      }
      if (position + bytesRead > expected.bytes) {
        throw unavailable();
      }
      digest.update(bytes.subarray(0, bytesRead));
      if (target) {
        let offset = 0;
        while (offset < bytesRead) {
          const { bytesWritten } = await target.write(
            bytes,
            offset,
            bytesRead - offset,
            position + offset,
          );
          if (bytesWritten === 0) {
            throw unavailable();
          }
          offset += bytesWritten;
        }
      }
      position += bytesRead;
    }
    await inspect();
    if (
      position !== expected.bytes ||
      digest.digest('hex') !== expected.sha256
    ) {
      throw unavailable();
    }
  }

  private async writeMetadata(
    bundle: FileHandle,
    name: string,
    bytes: Buffer,
  ): Promise<void> {
    const file = await open(
      posix.join(anchor(bundle), name),
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600,
    );
    try {
      await file.writeFile(bytes);
      await file.chmod(0o400);
      await file.sync();
    } finally {
      await file.close();
    }
  }
  private async metadata(
    bundle: FileHandle,
    name: string,
    expected: Buffer,
  ): Promise<void> {
    const file = await open(
      posix.join(anchor(bundle), name),
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const info = await file.stat();
      if (
        !info.isFile() ||
        info.nlink !== 1 ||
        !permissions(info, 0o400) ||
        info.size !== expected.length
      ) {
        throw unavailable();
      }
      const bytes = Buffer.alloc(expected.length + 1);
      let offset = 0;
      while (offset < bytes.length) {
        const { bytesRead } = await file.read(
          bytes,
          offset,
          bytes.length - offset,
          offset,
        );
        if (bytesRead === 0) {
          break;
        }
        offset += bytesRead;
      }
      if (
        offset !== expected.length ||
        !bytes.subarray(0, offset).equals(expected)
      ) {
        throw unavailable();
      }
    } finally {
      await file.close();
    }
  }
}
