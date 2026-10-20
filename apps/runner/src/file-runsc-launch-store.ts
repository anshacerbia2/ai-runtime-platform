import { constants, type Stats, type BigIntStats } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import {
  lstat,
  open,
  opendir,
  realpath,
  link,
  unlink,
  type FileHandle,
} from 'node:fs/promises';
import { posix } from 'node:path';
import {
  runscSandboxId,
  type RunscLaunchRecord,
} from './runsc-sandbox-driver.js';

export interface FileRunscLaunchStoreOptions {
  /** Existing canonical private Linux directories, owned by this effective UID. */
  directory: string;
  bundleRoot: string;
  maxRecords: number;
}

export interface RunscStoredReservation {
  readonly version: 1;
  readonly record: RunscLaunchRecord;
  /** Declared by the trusted bundle producer; this store is not an image verifier. */
  readonly configDigest: string;
}

const ID = /^airt-runner-[a-f0-9]{64}$/;
const MAX_BYTES = 8192;
const failure = () => new Error('Runsc launch store unavailable.');
const keys = (value: object, expected: readonly string[]) =>
  Object.keys(value).sort().join(',') === [...expected].sort().join(',');
const identityKeys = [
  'assignmentId',
  'executionId',
  'attemptId',
  'runnerId',
  'ownerSubject',
  'bootId',
  'generation',
  'epoch',
] as const;

function canonicalPath(value: string): boolean {
  return (
    typeof value === 'string' &&
    value.length <= 2048 &&
    !value.includes('\0') &&
    posix.isAbsolute(value) &&
    posix.normalize(value) === value
  );
}

/** Strict metadata only: no prompts, payloads, credentials, nonce or runtime flags. */
export function makeRunscReservation(
  record: RunscLaunchRecord,
  configDigest: string,
  bundleRoot: string,
): RunscStoredReservation {
  if (
    !record ||
    !record.identity ||
    !keys(record, ['identity', 'sandboxId', 'bundle']) ||
    !keys(record.identity, identityKeys) ||
    !canonicalPath(bundleRoot) ||
    !/^sha256:[a-f0-9]{64}$/.test(configDigest) ||
    record.sandboxId !== runscSandboxId(record.identity) ||
    record.bundle !== posix.join(bundleRoot, record.sandboxId)
  ) {
    throw failure();
  }
  const identity = Object.freeze(
    Object.fromEntries(identityKeys.map((key) => [key, record.identity[key]])),
  ) as unknown as RunscLaunchRecord['identity'];
  return Object.freeze({
    version: 1,
    record: Object.freeze({
      identity,
      sandboxId: record.sandboxId,
      bundle: record.bundle,
    }),
    configDigest,
  });
}

function privateOwner(info: Stats | BigIntStats): boolean {
  return (
    Number(info.uid) === process.geteuid?.() &&
    (Number(info.mode) & 0o077) === 0
  );
}

async function privateDirectory(path: string): Promise<FileHandle> {
  const handle = await open(
    path,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  try {
    await checkDirectory(path, handle);
    return handle;
  } catch (error) {
    await handle.close();
    throw error;
  }
}

async function checkDirectory(path: string, handle: FileHandle): Promise<void> {
  const info = await handle.stat({ bigint: true });
  const named = await lstat(path, { bigint: true });
  if (
    !info.isDirectory() ||
    !privateOwner(info) ||
    !privateOwner(named) ||
    named.isSymbolicLink() ||
    named.dev !== info.dev ||
    named.ino !== info.ino ||
    (await realpath(path)) !== path
  ) {
    throw failure();
  }
}

/**
 * Async, bounded, single-writer reservation metadata. No eviction, unlink API,
 * PID/TTL takeover, runtime ownership proof or default production composition.
 * Recovered stores only read/replay; new work awaits a future retirement protocol.
 */
export class FileRunscLaunchStore {
  private readonly rows = new Map<string, string>();
  private queue: Promise<unknown> = Promise.resolve();
  private pending = 0;
  private poisoned = false;
  private closing = false;
  private closePromise: Promise<void> | null = null;
  private recovered = false;
  private readonly anchor: string;

  private constructor(
    private readonly options: FileRunscLaunchStoreOptions,
    private readonly directory: FileHandle,
    private readonly bundles: FileHandle,
    private readonly lock: FileHandle,
  ) {
    this.anchor = `/proc/self/fd/${directory.fd}`;
  }

  static async open(
    options: FileRunscLaunchStoreOptions,
  ): Promise<FileRunscLaunchStore> {
    const captured = { ...options };
    if (
      process.platform !== 'linux' ||
      !canonicalPath(captured.directory) ||
      !canonicalPath(captured.bundleRoot) ||
      captured.directory === captured.bundleRoot ||
      captured.directory.startsWith(`${captured.bundleRoot}/`) ||
      captured.bundleRoot.startsWith(`${captured.directory}/`) ||
      !Number.isSafeInteger(captured.maxRecords) ||
      captured.maxRecords < 1 ||
      captured.maxRecords > 256
    ) {
      throw failure();
    }
    let directory: FileHandle | undefined;
    let bundles: FileHandle | undefined;
    let lock: FileHandle | undefined;
    try {
      directory = await privateDirectory(captured.directory);
      bundles = await privateDirectory(captured.bundleRoot);
      lock = await open(
        `/proc/self/fd/${directory.fd}/writer.lock`,
        constants.O_WRONLY |
          constants.O_CREAT |
          constants.O_EXCL |
          constants.O_NOFOLLOW,
        0o600,
      );
      await lock.writeFile(
        JSON.stringify({ version: 1, ownerSession: randomUUID() }),
      );
      await lock.sync();
      await directory.sync();
      const store = new FileRunscLaunchStore(
        captured,
        directory,
        bundles,
        lock,
      );
      await store.load();
      return store;
    } catch {
      // If this open created a lock, preserve it on uncertain recovery. Never
      // remove a pre-existing lock, partial record or another owner's metadata.
      await Promise.allSettled([
        lock?.close(),
        directory?.close(),
        bundles?.close(),
      ]);
      throw failure();
    }
  }

  get recoveryRequired(): boolean {
    return this.recovered;
  }

  lookup(sandboxId: string): Promise<RunscStoredReservation | null> {
    if (!ID.test(sandboxId)) {
      return Promise.reject(failure());
    }
    return this.enqueue(async () => {
      if (this.rows.has(sandboxId)) {
        return this.read(sandboxId, this.rows.get(sandboxId));
      }
      try {
        await lstat(this.path(sandboxId));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          return null;
        }
        this.poisoned = true;
        throw failure();
      }
      this.poisoned = true;
      throw failure(); // Unexpected file is not a fresh slot.
    });
  }

  reserve(
    record: RunscLaunchRecord,
    configDigest: string,
  ): Promise<{ reservation: RunscStoredReservation; fresh: boolean }> {
    let reservation: RunscStoredReservation;
    try {
      reservation = makeRunscReservation(
        record,
        configDigest,
        this.options.bundleRoot,
      );
    } catch {
      return Promise.reject(failure());
    }
    return this.enqueue(async () => {
      const id = reservation.record.sandboxId;
      if (this.rows.has(id)) {
        const previous = await this.read(id, this.rows.get(id));
        if (JSON.stringify(previous) !== JSON.stringify(reservation)) {
          throw new Error('Runsc reservation conflict.');
        }
        return { reservation: previous, fresh: false };
      }
      if (this.recovered) {
        throw new Error(
          'Runsc launch store requires recovery before new work.',
        );
      }
      if (this.rows.size >= this.options.maxRecords) {
        throw new Error('Runsc launch store capacity exhausted.');
      }
      const bytes = Buffer.from(JSON.stringify(reservation));
      if (bytes.length > MAX_BYTES) {
        throw failure();
      }
      let file: FileHandle | undefined;
      try {
        const partial = posix.join(this.anchor, `${id}.partial`);
        file = await open(
          partial,
          constants.O_WRONLY |
            constants.O_CREAT |
            constants.O_EXCL |
            constants.O_NOFOLLOW,
          0o600,
        );
        await file.writeFile(bytes);
        await file.sync();
        await file.close();
        file = undefined;
        // link is no-clobber; a pre-existing final record is never overwritten.
        await link(partial, this.path(id));
        await unlink(partial);
        await this.directory.sync();
        this.rows.set(id, this.hash(bytes));
        return { reservation, fresh: true };
      } catch {
        this.poisoned = true;
        throw failure();
      } finally {
        await this.releaseFile(file);
      }
    });
  }

  /** Caller must stop/reap runtime creation before releasing host ownership. */
  close(options: { readonly retainLock?: boolean } = {}): Promise<void> {
    if (!this.closePromise) {
      const retainLock = options.retainLock === true;
      this.closing = true; // Seal immediately; accepted I/O finishes before unlock.
      this.closePromise = this.queue.then(async () => {
        let failed = false;
        try {
          await this.ownership();
          if (!retainLock) {
            await unlink(posix.join(this.anchor, 'writer.lock'));
            await this.directory.sync();
          }
        } catch {
          this.poisoned = true;
          failed = true;
        }
        const results = await Promise.allSettled([
          this.lock.close(),
          this.directory.close(),
          this.bundles.close(),
        ]);
        if (failed || results.some((result) => result.status === 'rejected')) {
          throw failure();
        }
      });
    }
    return this.closePromise;
  }

  private enqueue<T>(action: () => Promise<T>): Promise<T> {
    if (this.closing || this.poisoned) {
      return Promise.reject(failure());
    }
    if (this.pending >= 8) {
      return Promise.reject(
        new Error('Runsc launch store intake capacity exhausted.'),
      );
    }
    this.pending++;
    const result = this.queue.then(async () => {
      await this.ownership();
      return action();
    });
    this.queue = result.catch(() => {});
    return result.finally(() => {
      this.pending--;
    });
  }

  private async ownership(): Promise<void> {
    if (this.poisoned) {
      throw failure();
    }
    try {
      await checkDirectory(this.options.directory, this.directory);
      await checkDirectory(this.options.bundleRoot, this.bundles);
      const held = await this.lock.stat({ bigint: true });
      const named = await lstat(posix.join(this.anchor, 'writer.lock'), {
        bigint: true,
      });
      if (
        !held.isFile() ||
        !privateOwner(held) ||
        held.nlink !== 1n ||
        !privateOwner(named) ||
        named.nlink !== 1n ||
        named.isSymbolicLink() ||
        held.dev !== named.dev ||
        held.ino !== named.ino
      ) {
        throw failure();
      }
    } catch {
      this.poisoned = true;
      throw failure();
    }
  }

  private async load(): Promise<void> {
    await this.ownership();
    const entries = await opendir(this.anchor);
    for await (const entry of entries) {
      if (entry.name === 'writer.lock') {
        continue;
      }
      const id = entry.name.replace(/\.reservation$/, '');
      if (
        !entry.isFile() ||
        entry.name !== `${id}.reservation` ||
        !ID.test(id) ||
        this.rows.size >= this.options.maxRecords
      ) {
        throw failure();
      }
      const stored = await this.read(id);
      this.rows.set(id, this.hash(Buffer.from(JSON.stringify(stored))));
    }
    this.recovered = this.rows.size > 0;
  }

  private async read(
    id: string,
    expected?: string,
  ): Promise<RunscStoredReservation> {
    let file: FileHandle | undefined;
    try {
      file = await open(
        this.path(id),
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      const info = await file.stat();
      if (
        !info.isFile() ||
        !privateOwner(info) ||
        info.nlink !== 1 ||
        info.size < 1 ||
        info.size > MAX_BYTES
      ) {
        throw failure();
      }
      const bytes = Buffer.alloc(info.size + 1);
      let offset = 0;
      while (offset < bytes.length) {
        const result = await file.read(
          bytes,
          offset,
          bytes.length - offset,
          offset,
        );
        if (result.bytesRead === 0) {
          break;
        }
        offset += result.bytesRead;
      }
      const after = await file.stat();
      if (
        offset !== info.size ||
        after.size !== info.size ||
        after.nlink !== 1 ||
        !privateOwner(after)
      ) {
        throw failure();
      }
      const body = bytes.subarray(0, offset);
      const value = JSON.parse(body.toString('utf8')) as RunscStoredReservation;
      if (
        !value ||
        !keys(value, ['version', 'record', 'configDigest']) ||
        value.version !== 1
      ) {
        throw failure();
      }
      const stored = makeRunscReservation(
        value.record,
        value.configDigest,
        this.options.bundleRoot,
      );
      if (
        stored.record.sandboxId !== id ||
        JSON.stringify(stored) !== body.toString('utf8') ||
        (expected && this.hash(body) !== expected)
      ) {
        throw failure();
      }
      return stored;
    } catch {
      this.poisoned = true;
      throw failure();
    } finally {
      await this.releaseFile(file);
    }
  }

  private path(id: string): string {
    return posix.join(this.anchor, `${id}.reservation`);
  }
  private async releaseFile(file?: FileHandle): Promise<void> {
    try {
      await file?.close();
    } catch {
      this.poisoned = true;
      throw failure();
    }
  }
  private hash(bytes: Uint8Array): string {
    return createHash('sha256').update(bytes).digest('hex');
  }
}
