import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  constants,
  fstatSync,
  lstatSync,
  realpathSync,
  type BigIntStats,
} from 'node:fs';
import { lstat, open, realpath, type FileHandle } from 'node:fs/promises';
import { posix } from 'node:path';
import { TextDecoder } from 'node:util';
import type { SandboxLaunchGuard } from './sandbox-supervisor.js';
import {
  captureRunscIdentity,
  runscSandboxId,
  type RunscLaunchRecord,
} from './runsc-sandbox-driver.js';

export interface RunscProcessClientOptions {
  executable: string;
  /** Independent trusted entrypoint pin; not approval of adjacent runtime sidecars. */
  approvedExecutableSha256: string;
  stateRoot: string;
  bundleRoot: string;
  commandTimeoutMs: number;
  runTimeoutMs: number;
}
export interface RunscProcessExit {
  readonly state: 'REAPED' | 'LOST';
  readonly code: number | null;
}
export interface RunscListEntry {
  readonly id: string;
  readonly status: 'created' | 'running' | 'paused' | 'stopped';
}
const unavailable = () => new Error('Runsc process unavailable.');
const canonical = (value: string) =>
  typeof value === 'string' &&
  value.length <= 2048 &&
  !value.includes('\0') &&
  posix.isAbsolute(value) &&
  posix.normalize(value) === value;
const within = (parent: string, child: string) =>
  child === parent || child.startsWith(`${parent}/`);
const owned = (info: BigIntStats) => Number(info.uid) === process.geteuid?.();
const sameNode = (a: BigIntStats, b: BigIntStats) =>
  a.dev === b.dev && a.ino === b.ino;
const statuses = ['created', 'running', 'paused', 'stopped'];
const env = Object.freeze({ PATH: '/usr/sbin:/usr/bin:/sbin:/bin', LANG: 'C' });
class LaunchDenied extends Error {}

interface Anchor {
  path: string;
  file: FileHandle;
  initial: BigIntStats;
  directory: boolean;
  private: boolean;
}

/** Native CLI transport only. No ownership takeover, authority, result or stop proof. */
export class RunscProcessClient {
  private closed = false;
  private uncertain = false;
  private commands = 0;
  private runs = 0;
  private readonly attempted = new Set<string>();
  private readonly pending = new Set<Promise<unknown>>();
  private closing?: Promise<void>;

  private constructor(
    private readonly options: Readonly<RunscProcessClientOptions>,
    private readonly anchors: readonly Anchor[],
  ) {}

  static async open(
    options: RunscProcessClientOptions,
  ): Promise<RunscProcessClient> {
    // Refuse unsupported hosts before any filesystem access or child spawn.
    if (
      process.platform !== 'linux' ||
      !options ||
      Object.keys(options).sort().join(',') !==
        [
          'executable',
          'approvedExecutableSha256',
          'stateRoot',
          'bundleRoot',
          'commandTimeoutMs',
          'runTimeoutMs',
        ]
          .sort()
          .join(',') ||
      ![options.executable, options.stateRoot, options.bundleRoot].every(
        canonical,
      ) ||
      !/^[a-f0-9]{64}$/.test(options.approvedExecutableSha256) ||
      !Number.isSafeInteger(options.commandTimeoutMs) ||
      options.commandTimeoutMs < 10 ||
      options.commandTimeoutMs > 30000 ||
      !Number.isSafeInteger(options.runTimeoutMs) ||
      options.runTimeoutMs < 10 ||
      options.runTimeoutMs > 3600000 ||
      within(options.stateRoot, options.bundleRoot) ||
      within(options.bundleRoot, options.stateRoot) ||
      within(options.stateRoot, options.executable) ||
      within(options.bundleRoot, options.executable)
    ) {
      throw unavailable();
    }
    const captured = Object.freeze({ ...options });
    const anchors: Anchor[] = [];
    const opened: FileHandle[] = [];
    try {
      for (const [path, directory, privateRoot] of [
        [captured.executable, false, false],
        [posix.dirname(captured.executable), true, false],
        [captured.stateRoot, true, true],
        [captured.bundleRoot, true, true],
      ] as const) {
        if ((await realpath(path)) !== path) {
          throw unavailable();
        }
        const file = await open(
          path,
          constants.O_RDONLY |
            constants.O_NOFOLLOW |
            constants.O_NONBLOCK |
            (directory ? constants.O_DIRECTORY : 0),
        );
        opened.push(file);
        const anchor: Anchor = {
          path,
          file,
          initial: await file.stat({ bigint: true }),
          directory,
          private: privateRoot,
        };
        anchors.push(anchor);
        const named = await lstat(path, { bigint: true });
        if (!sameNode(anchor.initial, named)) {
          throw unavailable();
        }
      }
      const client = new RunscProcessClient(captured, anchors);
      client.check();
      const executable = anchors[0]!;
      if (
        executable.initial.size < 1n ||
        executable.initial.size > 268435456n
      ) {
        throw unavailable();
      }
      const hash = createHash('sha256');
      const buffer = Buffer.alloc(65536);
      let offset = 0;
      while (offset < Number(executable.initial.size)) {
        const { bytesRead } = await executable.file.read(
          buffer,
          0,
          Math.min(buffer.length, Number(executable.initial.size) - offset),
          offset,
        );
        if (!bytesRead) {
          throw unavailable();
        }
        hash.update(buffer.subarray(0, bytesRead));
        offset += bytesRead;
      }
      if (hash.digest('hex') !== captured.approvedExecutableSha256) {
        throw unavailable();
      }
      client.check();
      return client;
    } catch {
      await Promise.allSettled(opened.map((file) => file.close()));
      throw unavailable();
    }
  }

  get recoveryRequired(): boolean {
    return this.uncertain;
  }

  async list(): Promise<readonly RunscListEntry[]> {
    const text = await this.command(['list', '--format=json']);
    try {
      const value: unknown = JSON.parse(text);
      if (value === null) {
        return Object.freeze([]);
      }
      if (!Array.isArray(value) || value.length > 256) {
        throw unavailable();
      }
      const ids = new Set<string>();
      return Object.freeze(
        value.map((row: unknown) => {
          if (!row || typeof row !== 'object') {
            throw unavailable();
          }
          const item = row as Record<string, unknown>;
          if (
            typeof item.id !== 'string' ||
            !/^[A-Za-z0-9_-]{1,128}$/.test(item.id) ||
            !statuses.includes(String(item.status)) ||
            ids.has(item.id)
          ) {
            throw unavailable();
          }
          ids.add(item.id);
          return Object.freeze({
            id: item.id,
            status: item.status as RunscListEntry['status'],
          });
        }),
      );
    } catch {
      this.uncertain = true;
      throw unavailable();
    }
  }

  /** Callers must validate fresh state against the complete reservation binding. */
  async readState(record: RunscLaunchRecord): Promise<unknown> {
    const captured = this.record(record);
    const text = await this.command(['state', captured.sandboxId]);
    try {
      const value: unknown = JSON.parse(text);
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw unavailable();
      }
      return value;
    } catch {
      this.uncertain = true;
      throw unavailable();
    }
  }

  async signalAll(
    record: RunscLaunchRecord,
    signal: 'TERM' | 'KILL',
  ): Promise<void> {
    const captured = this.record(record);
    if (signal !== 'TERM' && signal !== 'KILL') {
      throw unavailable();
    }
    await this.command(['kill', '--all', captured.sandboxId, signal]);
  }

  async destroy(record: RunscLaunchRecord): Promise<void> {
    const captured = this.record(record);
    await this.command(['delete', '--force', captured.sandboxId]);
  }

  /** Synchronous validation and spawn: no promise/queue between the caller guard and run. */
  run(
    record: RunscLaunchRecord,
    guard?: SandboxLaunchGuard,
  ): {
    readonly finished: Promise<RunscProcessExit>;
  } {
    const captured = this.record(record);
    this.check();
    if (
      this.uncertain ||
      this.attempted.has(captured.sandboxId) ||
      this.attempted.size >= 256 ||
      this.runs >= 8
    ) {
      throw unavailable();
    }
    this.attempted.add(captured.sandboxId); // Seal even a synchronous spawn failure.
    this.runs++;
    try {
      const child = this.start(
        ['run', '--bundle', captured.bundle, captured.sandboxId],
        this.options.runTimeoutMs,
        1048576,
        false,
        guard,
      );
      const finished = child
        .then((result) => {
          if (result.exit.state === 'LOST') {
            this.uncertain = true;
          }
          return result.exit;
        })
        .finally(() => {
          this.runs--;
        });
      this.track(finished);
      return Object.freeze({ finished });
    } catch (error) {
      this.runs--;
      if (!(error instanceof LaunchDenied)) {
        this.uncertain = true;
      }
      throw unavailable();
    }
  }

  /** Seal intake and drain accepted monitors/commands; never infer sandbox exit. */
  close(): Promise<void> {
    if (!this.closing) {
      this.closed = true;
      this.closing = (async () => {
        await Promise.allSettled([...this.pending]);
        const results = await Promise.allSettled(
          this.anchors.map((anchor) => anchor.file.close()),
        );
        if (results.some((result) => result.status === 'rejected')) {
          throw unavailable();
        }
      })();
    }
    return this.closing;
  }

  private record(record: RunscLaunchRecord): RunscLaunchRecord {
    try {
      const identity = captureRunscIdentity(record.identity);
      const sandboxId = runscSandboxId(identity);
      if (
        record.sandboxId !== sandboxId ||
        record.bundle !== posix.join(this.options.bundleRoot, sandboxId)
      ) {
        throw unavailable();
      }
      return Object.freeze({ identity, sandboxId, bundle: record.bundle });
    } catch {
      throw unavailable();
    }
  }

  private check(): void {
    if (this.closed) {
      throw unavailable();
    }
    try {
      for (const anchor of this.anchors) {
        const held = fstatSync(anchor.file.fd, { bigint: true });
        const named = lstatSync(anchor.path, { bigint: true });
        if (
          !sameNode(held, named) ||
          !sameNode(held, anchor.initial) ||
          !owned(held) ||
          !owned(named) ||
          named.isSymbolicLink() ||
          realpathSync(anchor.path) !== anchor.path ||
          (Number(held.mode) & 0o7022) !== 0 ||
          (anchor.private && (Number(held.mode) & 0o777) !== 0o700) ||
          (anchor.directory
            ? !held.isDirectory()
            : !held.isFile() ||
              held.nlink !== 1n ||
              (Number(held.mode) & 0o100) === 0 ||
              held.size !== anchor.initial.size ||
              held.mtimeNs !== anchor.initial.mtimeNs ||
              held.ctimeNs !== anchor.initial.ctimeNs)
        ) {
          throw unavailable();
        }
      }
    } catch {
      this.uncertain = true;
      throw unavailable();
    }
  }

  private async command(args: readonly string[]): Promise<string> {
    this.check();
    if (this.commands >= 4) {
      throw unavailable();
    }
    this.commands++;
    const accepted = (async () => {
      try {
        const result = await this.start(
          args,
          this.options.commandTimeoutMs,
          65536,
          true,
        );
        if (result.exit.state !== 'REAPED') {
          this.uncertain = true;
          throw unavailable();
        }
        if (result.exit.code !== 0) {
          throw unavailable();
        }
        try {
          return new TextDecoder('utf-8', { fatal: true }).decode(
            result.output,
          );
        } catch {
          this.uncertain = true;
          throw unavailable();
        }
      } catch {
        throw unavailable();
      } finally {
        this.commands--;
      }
    })();
    this.track(accepted);
    return accepted;
  }

  private track(promise: Promise<unknown>): void {
    this.pending.add(promise);
    void promise.then(
      () => this.pending.delete(promise),
      () => this.pending.delete(promise),
    );
  }

  private start(
    args: readonly string[],
    timeout: number,
    maxBytes: number,
    capture: boolean,
    guard?: SandboxLaunchGuard,
  ): Promise<{ exit: RunscProcessExit; output: Buffer }> {
    // Only this class builds argv. No shell, inherited env, caller flags or stdin.
    const argv = [
      `--root=${this.options.stateRoot}`,
      '--platform=systrap',
      '--network=none',
      ...args,
    ];
    const options = {
      env,
      stdio: ['ignore', 'pipe', 'pipe'] as ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      cwd: this.options.stateRoot,
    };
    // Filesystem checks can consume a lease even without an await. No I/O,
    // await or queue is allowed after this final authority/stop/drain recheck.
    if (guard) {
      try {
        if (!guard.canLaunch()) {
          throw new LaunchDenied();
        }
      } catch {
        throw new LaunchDenied();
      }
    }
    const child = spawn(this.options.executable, argv, options);
    return new Promise((resolve) => {
      let settled = false;
      let lost = false;
      let interrupted = false;
      let bytes = 0;
      let exited = false;
      const chunks: Buffer[] = [];
      const interrupt = () => {
        if (settled || interrupted) {
          return;
        }
        // A failed kill may itself emit error. Never recursively signal/retry;
        // retain uncertainty until an actual exit observation can reap the child.
        interrupted = true;
        lost = true;
        this.uncertain = true;
        // This kills only our CLI monitor, NOT a proof that the guest tree exited.
        child.kill('SIGKILL');
        if (exited) {
          finish(null);
        }
      };
      const timer = setTimeout(interrupt, timeout);
      const finish = (code: number | null) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        // Descendants may retain pipes. Original-child exit, not pipe EOF, is the
        // monitor observation; never wait for an arbitrary inherited stdout FD.
        child.stdout.destroy();
        child.stderr.destroy();
        const state = !lost && code !== null ? 'REAPED' : 'LOST';
        resolve({
          exit: Object.freeze({
            state,
            code: state === 'REAPED' ? code : null,
          }),
          output: capture && !lost ? Buffer.concat(chunks) : Buffer.alloc(0),
        });
      };
      const data = (chunk: Buffer, stdout: boolean) => {
        if (settled || lost) {
          return;
        }
        bytes += chunk.length;
        if (bytes > maxBytes) {
          interrupt();
          return;
        }
        if (capture && stdout) {
          chunks.push(chunk);
        }
      };
      child.stdout.on('data', (chunk: Buffer) => data(chunk, true));
      child.stderr.on('data', (chunk: Buffer) => data(chunk, false));
      child.stdout.on('error', interrupt);
      child.stderr.on('error', interrupt);
      child.once('error', () => {
        lost = true;
        this.uncertain = true;
        if (child.pid === undefined) {
          finish(null);
        } else {
          interrupt();
        }
      });
      child.once('exit', (code) => {
        exited = true;
        if (!capture || lost) {
          finish(code);
        }
      });
      // Control replies must drain before decoding. Their deadline remains in
      // force even after parent exit if an inherited pipe is still held open.
      if (capture) {
        child.once('close', (code) => finish(code));
      }
    });
  }
}
