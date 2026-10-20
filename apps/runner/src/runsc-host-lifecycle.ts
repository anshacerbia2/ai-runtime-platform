import { setTimeout as pause } from 'node:timers/promises';
import { posix } from 'node:path';
import {
  makeRunscReservation,
  type FileRunscLaunchStore,
} from './file-runsc-launch-store.js';
import type { FileRunscBundleProducer } from './file-runsc-bundle-producer.js';
import type { RunscCgroupInspector } from './runsc-cgroup-inspector.js';
import type {
  RunscProcessClient,
  RunscProcessExit,
} from './runsc-process-client.js';
import {
  captureRunscIdentity,
  runscBindingAnnotation,
  runscSandboxId,
  type RunscLaunchRecord,
  type RunscSandboxHost,
} from './runsc-sandbox-driver.js';
import type {
  SandboxIdentity,
  SandboxLaunchGuard,
} from './sandbox-supervisor.js';

/** Trusted, exclusively owned components. Never supplied by requests/plugins. */
export interface RunscHostPorts {
  store: Pick<
    FileRunscLaunchStore,
    'lookup' | 'reserve' | 'close' | 'recoveryRequired'
  >;
  bundles: Pick<
    FileRunscBundleProducer,
    'prepare' | 'verify' | 'close' | 'recoveryRequired'
  >;
  runtime: Pick<
    RunscProcessClient,
    | 'list'
    | 'readState'
    | 'run'
    | 'signalAll'
    | 'destroy'
    | 'close'
    | 'recoveryRequired'
  >;
  cgroups: Pick<RunscCgroupInspector, 'empty' | 'close' | 'recoveryRequired'>;
}
export interface RunscHostPolicy {
  readonly bundleRoot: string;
  readonly program: string;
  readonly approvedRootfsDigest: string;
}
interface Entry {
  readonly binding: string;
  reservation?: Promise<{ record: RunscLaunchRecord; fresh: boolean }>;
  record?: RunscLaunchRecord;
  configDigest?: string;
  attempted: boolean;
  monitor?: Promise<RunscProcessExit>;
  ready?: Promise<void>;
}
const unavailable = () => new Error('Runsc host unavailable.');
const shutdownFailure = () =>
  new Error('Runsc host shutdown unconfirmed; ownership retained.');

/**
 * Local lifecycle only. The caller must exclusively own an initially empty
 * runtime/bundle/reservation namespace and transfer all component lifetimes.
 * NativeRunscHost.open enforces that layout and startup check on Linux.
 */
export class RunscHostLifecycle implements RunscSandboxHost {
  private readonly entries = new Map<string, Entry>();
  private queue: Promise<unknown> = Promise.resolve();
  private pending = 0;
  private closing = false;
  private uncertain = false;
  private closed: Promise<void> | null = null;
  private readonly policy: RunscHostPolicy;

  constructor(
    private readonly ports: RunscHostPorts,
    policy: RunscHostPolicy,
  ) {
    // Validate the fixed policy through the same strict reservation schema.
    if (
      !/^[a-z][a-z0-9-]{0,31}$/.test(policy.program) ||
      !/^sha256:[a-f0-9]{64}$/.test(policy.approvedRootfsDigest) ||
      !posix.isAbsolute(policy.bundleRoot) ||
      posix.resolve(policy.bundleRoot) !== policy.bundleRoot ||
      policy.bundleRoot.length > 2048 ||
      policy.bundleRoot.includes('\0')
    ) {
      throw unavailable();
    }
    this.policy = Object.freeze({ ...policy });
  }

  reserve(
    identity: SandboxIdentity,
    sandboxId: string,
  ): Promise<{ record: RunscLaunchRecord; fresh: boolean }> {
    try {
      if (this.closing) {
        throw unavailable();
      }
      const captured = captureRunscIdentity(identity);
      if (runscSandboxId(captured) !== sandboxId) {
        throw unavailable();
      }
      const binding = JSON.stringify(captured);
      const previous = this.entries.get(sandboxId);
      if (previous) {
        if (previous.binding !== binding) {
          throw unavailable();
        }
        return this.accept(async () => {
          const { record } = await previous.reservation!;
          const saved = await this.ports.store.lookup(sandboxId);
          if (
            !saved ||
            saved.configDigest !== previous.configDigest ||
            JSON.stringify(saved.record) !== JSON.stringify(record)
          ) {
            throw unavailable();
          }
          return { record, fresh: false };
        });
      }
      this.intake();
      if (this.entries.size >= 256 || this.pending >= 8) {
        throw new Error('Runsc host capacity exhausted.');
      }
      const entry: Entry = {
        binding,
        attempted: false,
      };
      entry.reservation = this.enqueue(async () => {
        if (this.recoveryRequired()) {
          throw unavailable();
        }
        if (await this.ports.store.lookup(sandboxId)) {
          throw unavailable();
        }
        await this.ports.bundles.prepare(captured, this.policy.program);
        const verified = await this.ports.bundles.verify(
          captured,
          this.policy.program,
        );
        const expected = makeRunscReservation(
          verified.record,
          verified.configDigest,
          this.policy.bundleRoot,
        );
        if (
          JSON.stringify(expected.record.identity) !== binding ||
          expected.record.sandboxId !== sandboxId ||
          verified.rootfsDigest !== this.policy.approvedRootfsDigest
        ) {
          throw unavailable();
        }
        const saved = await this.ports.store.reserve(
          expected.record,
          expected.configDigest,
        );
        if (
          !saved.fresh ||
          JSON.stringify(saved.reservation) !== JSON.stringify(expected)
        ) {
          throw unavailable();
        }
        entry.record = expected.record;
        entry.configDigest = expected.configDigest;
        return { record: expected.record, fresh: true };
      });
      this.entries.set(sandboxId, entry); // Seal before asynchronous preparation.
      return entry.reservation;
    } catch (error) {
      return Promise.reject(error);
    }
  }

  lookup(sandboxId: string): Promise<RunscLaunchRecord | null> {
    return this.accept(async () => {
      const saved = await this.ports.store.lookup(sandboxId);
      if (!saved) {
        return null;
      }
      const entry = this.entry(saved.record);
      if (saved.configDigest !== entry.configDigest) {
        throw unavailable();
      }
      return entry.record!;
    });
  }

  start(
    record: RunscLaunchRecord,
    guard?: SandboxLaunchGuard,
  ): { ready: Promise<void>; finished: Promise<'REAPED' | 'LOST'> } {
    this.intake();
    const entry = this.entry(record);
    if (entry.attempted || this.recoveryRequired()) {
      throw unavailable();
    }
    entry.attempted = true; // Consume before any possible spawn or validation failure.
    try {
      const monitor = this.ports.runtime.run(entry.record!, {
        canLaunch: () =>
          !this.closing &&
          !this.uncertain &&
          !this.recoveryRequired() &&
          (!guard || guard.canLaunch()) &&
          !this.closing,
      });
      entry.monitor = monitor.finished.then(
        (result) => {
          if (result.state !== 'REAPED') {
            this.uncertain = true;
          }
          return result;
        },
        () => {
          this.uncertain = true;
          return { state: 'LOST', code: null };
        },
      );
      entry.ready = this.readiness(entry);
      // Retain rejection observation even if the caller has already stopped.
      void entry.ready.catch(() => {});
      return {
        ready: entry.ready,
        finished: entry.monitor.then((result) => result.state),
      };
    } catch {
      this.uncertain = true; // No proof that a synchronous failure never spawned.
      throw unavailable();
    }
  }

  state(record: RunscLaunchRecord): Promise<unknown | null> {
    return this.accept(() => this.observation(this.entry(record).record!));
  }
  signalAll(record: RunscLaunchRecord, signal: 'TERM' | 'KILL'): Promise<void> {
    return this.accept(async () => {
      const captured = this.entry(record).record!;
      const value = await this.observation(captured);
      if (
        value === null ||
        !['running', 'paused'].includes(this.status(captured, value))
      ) {
        throw unavailable();
      }
      await this.ports.runtime.signalAll(captured, signal);
    });
  }
  destroy(record: RunscLaunchRecord): Promise<void> {
    return this.accept(async () => {
      const captured = this.entry(record).record!;
      await this.observation(captured); // Foreign state can never authorize deletion.
      await this.ports.runtime.destroy(captured);
    });
  }
  cgroupEmpty(record: RunscLaunchRecord): Promise<boolean> {
    return this.accept(() =>
      this.ports.cgroups.empty(this.entry(record).record!.identity),
    );
  }

  /** Passive final proof, not a shutdown signal. Quiesce/stop the supervisor first. */
  close(options: { readonly retainLock?: boolean } = {}): Promise<void> {
    if (!this.closed) {
      // Capture the outer owner's decision once, before any asynchronous proof.
      if (options.retainLock === true) {
        this.uncertain = true;
      }
      this.closing = true; // No late start, even while an accepted prepare drains.
      this.closed = this.finishClose();
    }
    return this.closed;
  }

  private async finishClose(): Promise<void> {
    let retained = false;
    await this.queue;
    const entries = [...this.entries.values()];
    await Promise.allSettled(
      entries.flatMap((entry) =>
        [entry.ready, entry.monitor].filter((value) => value !== undefined),
      ),
    );
    await this.queue; // Drain the last admitted readiness observation too.
    try {
      if (this.uncertain || this.recoveryRequired()) {
        throw unavailable();
      }
      const initial = await this.ports.runtime.list();
      if (initial.some((row) => !this.entries.get(row.id)?.record)) {
        throw unavailable();
      }
      for (const entry of entries) {
        if (!entry.record) {
          throw unavailable();
        }
        const saved = await this.ports.store.lookup(entry.record.sandboxId);
        if (
          !saved ||
          saved.configDigest !== entry.configDigest ||
          JSON.stringify(saved.record) !== JSON.stringify(entry.record)
        ) {
          throw unavailable();
        }
        const observed = await this.observation(entry.record);
        if (
          observed !== null &&
          (!entry.attempted ||
            this.status(entry.record, observed) !== 'stopped')
        ) {
          throw unavailable();
        }
        if (entry.attempted) {
          if (!entry.monitor || (await entry.monitor).state !== 'REAPED') {
            throw unavailable();
          }
          await this.ports.runtime.destroy(entry.record);
        }
        if (
          !(await this.ports.cgroups.empty(entry.record.identity)) ||
          (await this.observation(entry.record)) !== null
        ) {
          throw unavailable();
        }
      }
      if ((await this.ports.runtime.list()).length !== 0) {
        throw unavailable();
      }
    } catch {
      retained = true;
    }
    // Close every component before ownership can be released. A failure is sticky.
    const results = await Promise.allSettled([
      this.ports.bundles.close(),
      this.ports.runtime.close(),
      this.ports.cgroups.close(),
    ]);
    retained ||= results.some((result) => result.status === 'rejected');
    try {
      await this.ports.store.close({ retainLock: retained });
    } catch {
      retained = true;
    }
    if (retained) {
      throw shutdownFailure();
    }
  }

  private async readiness(entry: Entry): Promise<void> {
    let exit: RunscProcessExit | undefined;
    void entry.monitor!.then((result) => {
      exit = result;
    });
    while (!exit && !this.closing) {
      try {
        const value = await this.enqueue(
          () => this.observation(entry.record!),
          false,
        );
        if (value !== null && this.status(entry.record!, value) === 'running') {
          return;
        }
      } catch {
        // State may disappear between list and state during a fast exit. Keep
        // the original bounded monitor until creation settles; never early reject.
      }
      if (!exit && !this.closing) {
        await pause(25);
      }
    }
    const result = await entry.monitor!;
    if (result.state !== 'REAPED' || result.code !== 0) {
      throw new Error('Runtime startup unconfirmed.');
    }
  }
  private async observation(
    record: RunscLaunchRecord,
  ): Promise<unknown | null> {
    const rows = await this.ports.runtime.list();
    if (!rows.some((row) => row.id === record.sandboxId)) {
      return null;
    }
    const value = await this.ports.runtime.readState(record);
    this.status(record, value);
    return value;
  }
  private status(record: RunscLaunchRecord, value: unknown): string {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      this.uncertain = true;
      throw unavailable();
    }
    const row = value as Record<string, unknown>;
    const annotations = row.annotations as Record<string, unknown> | undefined;
    if (
      row.id !== record.sandboxId ||
      row.bundle !== record.bundle ||
      !['created', 'running', 'paused', 'stopped'].includes(
        String(row.status),
      ) ||
      annotations?.[runscBindingAnnotation] !== JSON.stringify(record.identity)
    ) {
      this.uncertain = true;
      throw unavailable();
    }
    return String(row.status);
  }
  private entry(record: RunscLaunchRecord): Entry {
    const entry = this.entries.get(record.sandboxId);
    if (
      !entry?.record ||
      JSON.stringify(
        makeRunscReservation(
          record,
          entry.configDigest!,
          this.policy.bundleRoot,
        ).record,
      ) !== JSON.stringify(entry.record)
    ) {
      throw unavailable();
    }
    return entry;
  }
  private recoveryRequired(): boolean {
    return (
      this.ports.store.recoveryRequired ||
      this.ports.bundles.recoveryRequired ||
      this.ports.runtime.recoveryRequired ||
      this.ports.cgroups.recoveryRequired
    );
  }
  private intake(): void {
    if (this.closing || this.uncertain || this.recoveryRequired()) {
      throw unavailable();
    }
  }
  private accept<T>(action: () => Promise<T>): Promise<T> {
    try {
      // Cleanup remains available after transport/monitor loss until close begins.
      if (this.closing) {
        throw unavailable();
      }
      return this.enqueue(action);
    } catch (error) {
      return Promise.reject(error);
    }
  }
  private enqueue<T>(
    action: () => Promise<T>,
    poisonOnError = true,
  ): Promise<T> {
    if (this.pending >= 8) {
      return Promise.reject(new Error('Runsc host capacity exhausted.'));
    }
    this.pending++;
    const value = this.queue.then(action);
    this.queue = value.catch(() => {
      if (poisonOnError) {
        this.uncertain = true;
      }
    });
    return value.finally(() => {
      this.pending--;
    });
  }
}
