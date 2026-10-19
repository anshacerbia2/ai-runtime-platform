import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  opendirSync,
  readSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import type { EvidenceSpool } from './runner-evidence-collector.js';

export interface FileEvidenceSpoolOptions {
  /** Existing, canonical, private persistent directory owned by this Linux user. */
  directory: string;
  maxRecords: number;
  maxBytes: number;
}

const MAX_RECORD_BYTES = 65_536;
const failure = () => new Error('Evidence spool unavailable.');

/**
 * Encrypted records only. Single writer, no expiry/eviction. A leftover lock or
 * partial append needs operator recovery after proving the former owner stopped.
 * Synchronous fsync is deliberately explicit; host must isolate collector I/O
 * from a production worker event loop before deployment.
 */
export class FileEvidenceSpool implements EvidenceSpool {
  private readonly sizes = new Map<string, number>();
  private bytes = 0;
  private closed = false;
  private poisoned = false;
  private readonly directory: string;
  private readonly directoryFd: number;

  constructor(private readonly options: FileEvidenceSpoolOptions) {
    this.options = { ...options };
    let directoryFd: number | undefined;
    let locked = false;
    try {
      if (
        process.platform !== 'linux' ||
        !isAbsolute(options.directory) ||
        !Number.isSafeInteger(options.maxRecords) ||
        options.maxRecords < 1 ||
        options.maxRecords > 256 ||
        !Number.isSafeInteger(options.maxBytes) ||
        options.maxBytes < 1 ||
        options.maxBytes > 16_777_216
      ) {
        throw failure();
      }
      this.directory = resolve(options.directory);
      const root = lstatSync(this.directory);
      if (
        !root.isDirectory() ||
        root.isSymbolicLink() ||
        (root.mode & 0o077) !== 0 ||
        root.uid !== process.getuid?.() ||
        realpathSync(this.directory) !== this.directory
      ) {
        throw failure();
      }
      directoryFd = openSync(
        this.directory,
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
      );
      this.directoryFd = directoryFd;
      const lockFd = openSync(join(this.directory, 'writer.lock'), 'wx', 0o600);
      locked = true;
      try {
        fsyncSync(lockFd);
      } finally {
        closeSync(lockFd);
      }
      fsyncSync(directoryFd);
      const iterator = opendirSync(this.directory);
      try {
        for (
          let entry = iterator.readSync();
          entry !== null;
          entry = iterator.readSync()
        ) {
          if (entry.name === 'writer.lock') {
            continue;
          }
          if (
            !/^[a-f0-9]{64}\.evidence$/.test(entry.name) ||
            !entry.isFile() ||
            this.sizes.size >= options.maxRecords
          ) {
            throw failure();
          }
          const id = entry.name.slice(0, -'.evidence'.length);
          const fd = this.openRecord(id);
          try {
            const size = fstatSync(fd).size;
            this.sizes.set(id, size);
            this.bytes += size;
          } finally {
            closeSync(fd);
          }
          if (this.bytes > options.maxBytes) {
            throw failure();
          }
        }
      } finally {
        iterator.closeSync();
      }
    } catch {
      // Failed recovery preserves every record/partial for explicit inspection.
      if (locked && directoryFd !== undefined) {
        try {
          unlinkSync(join(options.directory, 'writer.lock'));
          fsyncSync(directoryFd);
        } catch {
          /* fail closed on the next open */
        }
      }
      if (directoryFd !== undefined) {
        closeSync(directoryFd);
      }
      throw failure();
    }
  }

  ids(): readonly string[] {
    this.check();
    return [...this.sizes.keys()];
  }

  read(id: string): Uint8Array {
    this.checkId(id);
    const size = this.sizes.get(id);
    if (size === undefined) {
      throw failure();
    }
    let fd: number | undefined;
    let output: Uint8Array | undefined;
    try {
      fd = this.openRecord(id);
      if (fstatSync(fd).size !== size) {
        throw failure();
      }
      output = new Uint8Array(size);
      let offset = 0;
      while (offset < size) {
        const count = readSync(fd, output, offset, size - offset, offset);
        if (count === 0) {
          throw failure();
        }
        offset += count;
      }
      return output;
    } catch {
      output?.fill(0);
      this.poisoned = true;
      throw failure();
    } finally {
      if (fd !== undefined) {
        closeSync(fd);
      }
    }
  }

  put(id: string, ciphertext: Uint8Array): void {
    this.checkId(id);
    if (
      this.sizes.has(id) ||
      ciphertext.length < 1 ||
      ciphertext.length > MAX_RECORD_BYTES ||
      this.sizes.size >= this.options.maxRecords ||
      this.bytes + ciphertext.length > this.options.maxBytes
    ) {
      throw failure();
    }
    let fd: number | undefined;
    try {
      const temporary = join(this.directory, `${id}.partial`);
      fd = openSync(temporary, 'wx', 0o600);
      let offset = 0;
      while (offset < ciphertext.length) {
        const count = writeSync(
          fd,
          ciphertext,
          offset,
          ciphertext.length - offset,
        );
        if (count === 0) {
          throw failure();
        }
        offset += count;
      }
      fsyncSync(fd);
      closeSync(fd);
      fd = undefined;
      renameSync(temporary, join(this.directory, `${id}.evidence`));
      fsyncSync(this.directoryFd);
      this.sizes.set(id, ciphertext.length);
      this.bytes += ciphertext.length;
    } catch {
      this.poisoned = true;
      throw failure();
    } finally {
      if (fd !== undefined) {
        closeSync(fd);
      }
    }
  }

  remove(id: string): void {
    this.checkId(id);
    const size = this.sizes.get(id);
    if (size === undefined) {
      throw failure();
    }
    try {
      unlinkSync(join(this.directory, `${id}.evidence`));
      fsyncSync(this.directoryFd);
      this.sizes.delete(id);
      this.bytes -= size;
    } catch {
      this.poisoned = true;
      throw failure();
    }
  }

  /** Host must await report/flush before releasing ownership. No records are deleted. */
  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    try {
      // A poisoned store retains its lock for explicit operator recovery.
      if (!this.poisoned) {
        unlinkSync(join(this.directory, 'writer.lock'));
        fsyncSync(this.directoryFd);
      }
    } catch {
      throw failure();
    } finally {
      closeSync(this.directoryFd);
    }
  }

  private check(): void {
    if (this.closed || this.poisoned) {
      throw failure();
    }
  }

  private checkId(id: string): void {
    this.check();
    if (!/^[a-f0-9]{64}$/.test(id)) {
      throw failure();
    }
  }

  private openRecord(id: string): number {
    const fd = openSync(
      join(this.directory, `${id}.evidence`),
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    try {
      const stat = fstatSync(fd);
      if (
        !stat.isFile() ||
        stat.nlink !== 1 ||
        stat.uid !== process.getuid?.() ||
        (stat.mode & 0o077) !== 0 ||
        stat.size < 1 ||
        stat.size > MAX_RECORD_BYTES
      ) {
        throw failure();
      }
      return fd;
    } catch {
      closeSync(fd);
      throw failure();
    }
  }
}
