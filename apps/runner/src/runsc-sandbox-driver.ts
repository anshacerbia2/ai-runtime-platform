import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import type {
  RecoveredSandbox,
  SandboxDriver,
  SandboxHandle,
  SandboxIdentity,
  SandboxLaunchGuard,
} from './sandbox-supervisor.js';

export const runscBindingAnnotation = 'org.ai-runtime.runner.binding.v1';

export interface RunscLaunchRecord {
  readonly identity: SandboxIdentity;
  readonly sandboxId: string;
  readonly bundle: string;
}

/**
 * Trusted host boundary, never implemented by a plugin. There is no default
 * production host. The Linux conformance fixture implements this port with real
 * runsc; image provenance, private durable storage and host recovery remain gates.
 */
export interface RunscSandboxHost {
  /**
   * Exclusive host owner; never overlap a previous owner's pending creation.
   * Single-writer, atomic, durable reservation BEFORE any execution. Retain all
   * reservations (including failed/unused launches), never evict/reuse an ID.
   * Prepare a verified immutable OCI bundle with the exact binding annotation.
   * Uncertain/partial writes must fail closed; fresh means only this caller may run.
   */
  reserve(
    identity: SandboxIdentity,
    sandboxId: string,
  ): Promise<{
    record: RunscLaunchRecord;
    fresh: boolean;
  }>;
  lookup(sandboxId: string): Promise<RunscLaunchRecord | null>;
  /**
   * Synchronously spawn attached runsc run (no await/queue/detach in this method).
   * Recheck the supplied guard after any synchronous host validation, immediately
   * before the OS spawn. Once spawn is attempted, retain its monitor on failure.
   * REAPED means the original monitor exited with a numeric status; LOST includes
   * errors/signals/timeouts. Neither means official execution completion.
   */
  start(
    record: RunscLaunchRecord,
    guard?: SandboxLaunchGuard,
  ): {
    /**
     * Resolve after exact running observation or confirmed fast successful exit.
     * On uncertain startup, reject only after the original monitor is reaped;
     * never reject early while creation can still emerge.
     */
    ready: Promise<void>;
    finished: Promise<'REAPED' | 'LOST'>;
  };
  /** Fresh OCI state; null only for an authoritative absence, never CLI failure. */
  state(record: RunscLaunchRecord): Promise<unknown | null>;
  /** Fixed runsc kill --all, no caller-supplied flags/PIDs/host-process signals. */
  signalAll(record: RunscLaunchRecord, signal: 'TERM' | 'KILL'): Promise<void>;
  /** Trusted runsc delete --force; missing alone cannot establish termination. */
  destroy(record: RunscLaunchRecord): Promise<void>;
  /** Inspect the entire owned kernel cgroup subtree, including runtime helpers. */
  cgroupEmpty(record: RunscLaunchRecord): Promise<boolean>;
}

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

export function captureRunscIdentity(
  identity: SandboxIdentity,
): SandboxIdentity {
  for (const key of identityKeys) {
    const value = identity[key];
    if (key === 'generation' || key === 'epoch') {
      if (!Number.isSafeInteger(value) || Number(value) < 1) {
        throw new Error('Invalid sandbox identity.');
      }
    } else if (typeof value !== 'string' || !value || value.length > 256) {
      throw new Error('Invalid sandbox identity.');
    }
  }
  return Object.freeze(
    Object.fromEntries(identityKeys.map((key) => [key, identity[key]])),
  ) as unknown as SandboxIdentity;
}

function sameIdentity(a: SandboxIdentity, b: SandboxIdentity): boolean {
  return identityKeys.every((key) => a[key] === b[key]);
}

/** One lifetime name per assignment; changing boot/epoch cannot select a new name. */
export function runscSandboxId(identity: SandboxIdentity): string {
  const binding = captureRunscIdentity(identity);
  return `airt-runner-${createHash('sha256').update(binding.assignmentId).digest('hex')}`;
}

interface Entry {
  identity: SandboxIdentity;
  handle: Promise<SandboxHandle | null>;
  recoverable: SandboxHandle | null;
}

/** Local lifecycle only. Does not grant authority, settle usage or permit retry. */
export class RunscSandboxDriver implements SandboxDriver {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly host: RunscSandboxHost) {}

  async launch(
    identity: SandboxIdentity,
    guard?: SandboxLaunchGuard,
  ): Promise<SandboxHandle> {
    const handle = await this.entry(identity, true, guard).handle;
    if (!handle) {
      throw new Error('Sandbox assignment was sealed by recovery.');
    }
    return handle;
  }

  async recover(identity: SandboxIdentity): Promise<RecoveredSandbox | null> {
    const entry = this.entry(identity, false);
    const handle = await entry.handle.catch((error: unknown) => {
      if (entry.recoverable) {
        return entry.recoverable;
      }
      throw error;
    });
    return handle ? { identity: { ...entry.identity }, handle } : null;
  }

  private entry(
    identity: SandboxIdentity,
    launch: boolean,
    guard?: SandboxLaunchGuard,
  ): Entry {
    const captured = captureRunscIdentity(identity);
    const id = runscSandboxId(captured);
    const existing = this.entries.get(id);
    if (existing) {
      if (!sameIdentity(existing.identity, captured)) {
        throw new Error('Sandbox identity mismatch.');
      }
      return existing;
    }
    if (this.entries.size >= 256) {
      throw new Error('Sandbox driver capacity exhausted.');
    }
    // Seal synchronously, before reserve/lookup can yield or throw. Never remove.
    const entry: Entry = {
      identity: captured,
      recoverable: null,
      handle: Promise.resolve().then(async () => {
        const reservation = launch
          ? await this.host.reserve(captured, id)
          : { record: await this.host.lookup(id), fresh: false };
        if (!reservation.record) {
          return null;
        }
        const supplied = reservation.record;
        if (
          supplied.sandboxId !== id ||
          !sameIdentity(captureRunscIdentity(supplied.identity), captured)
        ) {
          throw new Error('Recorded sandbox identity mismatch.');
        }
        if (
          !posix.isAbsolute(supplied.bundle) ||
          posix.normalize(supplied.bundle) !== supplied.bundle
        ) {
          throw new Error('Invalid sandbox bundle path.');
        }
        const record = Object.freeze({ ...supplied, identity: captured });
        const handle = new RunscHandle(this.host, record);
        entry.recoverable = handle;
        if (reservation.fresh) {
          // No asynchronous boundary is permitted between this guard and spawn.
          if (guard && !guard.canLaunch()) {
            throw new Error('Sandbox launch authority was lost.');
          }
          const monitor = this.host.start(record, guard);
          handle.monitor(monitor.finished);
          // Keep launch pending so supervisor stop also cleans up late creation.
          await monitor.ready;
        }
        return handle;
      }),
    };
    this.entries.set(id, entry);
    return entry;
  }
}

class RunscHandle implements SandboxHandle {
  private reaped = false;
  private observedStarted = false;
  private destroyed = false;
  private exited = false;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly host: RunscSandboxHost,
    private readonly record: RunscLaunchRecord,
  ) {}

  monitor(finished: Promise<'REAPED' | 'LOST'>): void {
    void finished.then(
      (result) => {
        this.reaped = result === 'REAPED';
      },
      () => {},
    );
  }

  requestStop(): Promise<void> {
    return this.serial(async () => {
      if (this.exited) {
        return;
      }
      const state = await this.observation();
      if (state === 'running' || state === 'paused') {
        await this.host.signalAll(this.record, 'TERM');
      }
    });
  }

  forceStop(): Promise<void> {
    return this.serial(async () => {
      if (this.exited) {
        return;
      }
      const state = await this.observation();
      if (
        state === null &&
        !this.reaped &&
        !this.destroyed &&
        !this.observedStarted
      ) {
        throw new Error('Sandbox termination remains unconfirmed.');
      }
      if (state === 'running' || state === 'paused') {
        await this.host.signalAll(this.record, 'KILL');
      }
      await this.host.destroy(this.record);
      this.destroyed = true;
    });
  }

  inspect(): Promise<'EXITED' | 'RUNNING' | 'UNKNOWN'> {
    return this.serial(async () => {
      if (this.exited) {
        return 'EXITED';
      }
      try {
        const state = await this.observation();
        if (state === 'running' || state === 'paused' || state === 'created') {
          return 'RUNNING';
        }
        if (
          state === null &&
          !this.reaped &&
          !this.destroyed &&
          !this.observedStarted
        ) {
          return 'UNKNOWN';
        }
        if (!this.destroyed) {
          await this.host.destroy(this.record);
          this.destroyed = true;
        }
        if (
          !(await this.host.cgroupEmpty(this.record)) ||
          (await this.observation()) !== null
        ) {
          return 'UNKNOWN';
        }
        this.exited = true;
        return 'EXITED';
      } catch {
        return 'UNKNOWN';
      }
    });
  }

  private async observation(): Promise<string | null> {
    const value = await this.host.state(this.record);
    if (value === null) {
      return null;
    }
    if (typeof value !== 'object') {
      throw new Error('Invalid runtime binding.');
    }
    const state = value as Record<string, unknown>;
    const annotations = state.annotations as
      Record<string, unknown> | undefined;
    if (
      state.id !== this.record.sandboxId ||
      state.bundle !== this.record.bundle ||
      !['created', 'running', 'stopped', 'paused'].includes(
        String(state.status),
      ) ||
      annotations?.[runscBindingAnnotation] !==
        JSON.stringify(this.record.identity)
    ) {
      throw new Error('Runtime sandbox binding mismatch.');
    }
    // Immutable names + exclusive host ownership forbid later recreation. A
    // previously started binding may disappear during runsc's attached teardown;
    // cleanup and kernel-subtree inspection are still required independently.
    if (state.status !== 'created') {
      this.observedStarted = true;
    }
    return String(state.status);
  }

  private serial<T>(action: () => Promise<T>): Promise<T> {
    const result = this.queue.then(action);
    this.queue = result.catch(() => {});
    return result;
  }
}
