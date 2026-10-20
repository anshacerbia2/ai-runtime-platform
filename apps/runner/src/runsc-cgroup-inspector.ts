import { constants, type BigIntStats } from 'node:fs';
import {
  lstat,
  open,
  realpath,
  statfs,
  type FileHandle,
} from 'node:fs/promises';
import { TextDecoder } from 'node:util';
import { runscSandboxId } from './runsc-sandbox-driver.js';
import type { SandboxIdentity } from './sandbox-supervisor.js';

const rootPath = '/sys/fs/cgroup';
const cgroup2Magic = 0x63677270n;
const unavailable = () => new Error('Runsc cgroup inspection unavailable.');
const anchor = (file: FileHandle) => `/proc/self/fd/${file.fd}`;
const same = (a: BigIntStats, b: BigIntStats) =>
  a.dev === b.dev && a.ino === b.ino;
const text = (bytes: Uint8Array, limit: number) => {
  try {
    if (bytes.byteLength > limit) {
      throw unavailable();
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw unavailable();
  }
};

/** Kernel cgroup.events population covers all descendants, including threaded subtrees. */
export function cgroupEventsEmpty(bytes: Uint8Array): boolean {
  const value = text(bytes, 1024);
  const fields = new Map<string, string>();
  if (!value.endsWith('\n')) {
    throw unavailable();
  }
  for (const line of value.slice(0, -1).split('\n')) {
    const match = /^(populated|frozen) ([01])$/.exec(line);
    if (!match || fields.has(match[1]!)) {
      throw unavailable();
    }
    fields.set(match[1]!, match[2]!);
  }
  if (!fields.has('populated')) {
    throw unavailable();
  }
  return fields.get('populated') === '0';
}

/** Zombie reaping is a separate monitor obligation; cgroup.procs omits zombies. */
export function cgroupProcsEmpty(bytes: Uint8Array): boolean {
  const value = text(bytes, 65536);
  if (!value) {
    return true;
  }
  if (
    !/^(?:[1-9][0-9]{0,9}\n)+$/.test(value) ||
    value
      .trimEnd()
      .split('\n')
      .some((pid) => Number(pid) > 2147483647)
  ) {
    throw unavailable();
  }
  return false;
}

/** Read-only local evidence. Does not own cgroups, kill PIDs, reap monitors or grant retry. */
export class RunscCgroupInspector {
  private closing = false;
  private poisoned = false;
  private admitted = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private closePromise?: Promise<void>;

  private constructor(
    private readonly root: FileHandle,
    private readonly initial: BigIntStats,
  ) {}

  static async open(): Promise<RunscCgroupInspector> {
    if (process.platform !== 'linux') {
      throw unavailable();
    }
    let root: FileHandle | undefined;
    try {
      if ((await realpath(rootPath)) !== rootPath) {
        throw unavailable();
      }
      root = await open(
        rootPath,
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
      );
      const inspector = new RunscCgroupInspector(
        root,
        await root.stat({ bigint: true }),
      );
      await inspector.checkRoot();
      return inspector;
    } catch {
      await root?.close();
      throw unavailable();
    }
  }

  get recoveryRequired(): boolean {
    return this.poisoned;
  }

  empty(identity: SandboxIdentity): Promise<boolean> {
    let id: string;
    try {
      id = runscSandboxId(identity);
    } catch {
      return Promise.reject(unavailable());
    }
    if (this.closing || this.poisoned || this.admitted >= 4) {
      return Promise.reject(unavailable());
    }
    this.admitted++;
    const accepted = this.queue.then(async () => {
      try {
        await this.checkRoot();
        return await this.inspect(id);
      } catch {
        this.poisoned = true;
        throw unavailable();
      } finally {
        this.admitted--;
      }
    });
    this.queue = accepted.catch(() => {});
    return accepted;
  }

  /** Drain accepted reads. This is not a stop receipt or an ownership unlock. */
  close(): Promise<void> {
    if (!this.closePromise) {
      this.closing = true;
      this.closePromise = this.queue.then(() => this.root.close());
    }
    return this.closePromise;
  }

  private async checkRoot(): Promise<void> {
    const held = await this.root.stat({ bigint: true });
    const named = await lstat(rootPath, { bigint: true });
    const filesystem = await statfs(anchor(this.root), { bigint: true });
    if (
      this.poisoned ||
      !held.isDirectory() ||
      !named.isDirectory() ||
      !same(held, named) ||
      !same(held, this.initial) ||
      held.uid !== 0n ||
      (Number(held.mode) & 0o022) !== 0 ||
      filesystem.type !== cgroup2Magic ||
      (await realpath(rootPath)) !== rootPath
    ) {
      throw unavailable();
    }
  }

  private async absent(path: string): Promise<boolean> {
    try {
      await lstat(path);
      return false;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return true;
      }
      throw error;
    }
  }

  private async read(
    group: FileHandle,
    name: string,
    maxBytes: number,
  ): Promise<Buffer> {
    const path = `${anchor(group)}/${name}`;
    const file = await open(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const info = await file.stat({ bigint: true });
      const named = await lstat(path, { bigint: true });
      if (
        !info.isFile() ||
        !same(info, named) ||
        info.dev !== this.initial.dev
      ) {
        throw unavailable();
      }
      const buffer = Buffer.alloc(maxBytes + 1);
      let offset = 0;
      while (offset < buffer.length) {
        const { bytesRead } = await file.read(
          buffer,
          offset,
          buffer.length - offset,
          null,
        );
        if (!bytesRead) {
          break;
        }
        offset += bytesRead;
      }
      if (offset > maxBytes) {
        throw unavailable();
      }
      return buffer.subarray(0, offset);
    } finally {
      await file.close();
    }
  }

  private async inspect(id: string): Promise<boolean> {
    const path = `${anchor(this.root)}/${id}`;
    let group: FileHandle | undefined;
    try {
      group = await open(
        path,
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
      );
      const held = await group.stat({ bigint: true });
      if (
        !held.isDirectory() ||
        held.dev !== this.initial.dev ||
        !same(held, await lstat(path, { bigint: true }))
      ) {
        throw unavailable();
      }
      if (text(await this.read(group, 'cgroup.type', 32), 32) !== 'domain\n') {
        throw unavailable();
      }
      const before = cgroupEventsEmpty(
        await this.read(group, 'cgroup.events', 1024),
      );
      const processes = cgroupProcsEmpty(
        await this.read(group, 'cgroup.procs', 65536),
      );
      const after = cgroupEventsEmpty(
        await this.read(group, 'cgroup.events', 1024),
      );
      await this.checkRoot();
      if (!same(held, await lstat(path, { bigint: true }))) {
        throw unavailable();
      }
      return before && processes && after;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        await this.checkRoot();
        // A removed cgroup cannot contain live tasks. Missing interface files
        // inside an existing group, read errors and replaced mounts never count.
        if (await this.absent(path)) {
          return true;
        }
        throw error;
      }
      throw error;
    } finally {
      await group?.close();
    }
  }
}
