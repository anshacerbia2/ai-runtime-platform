import { performance } from 'node:perf_hooks';
import { RunnerLeaseCommand } from '@ai-runtime/contracts/http';
import { RunnerLeaseGate, type MonotonicClock } from './runner-lease-gate.js';
import {
  RunnerLeaseHttpClient,
  type RunnerLeaseHttpOptions,
} from './runner-lease-http-client.js';
import { RunnerLeaseLoop, type LeaseTimerPort } from './runner-lease-loop.js';
import type {
  LocalSandboxSupervisor,
  SandboxIdentity,
  StopEvidence,
} from './sandbox-supervisor.js';

export interface RunnerAssignmentOptions {
  /** Authenticated process owner, supplied by the trusted runner composition. */
  ownerSubject: string;
  supervisor: LocalSandboxSupervisor;
  http: RunnerLeaseHttpOptions;
  clock?: MonotonicClock;
  timers?: LeaseTimerPort;
  /** Local launch wait only; timeout still requires bounded supervisor cleanup. */
  launchTimeoutMs?: number;
  /** Trusted process guard, rechecked at the queued sandbox-driver dispatch. */
  canLaunch?: () => boolean;
}

const UNCONFIRMED: StopEvidence = { state: 'UNCONFIRMED', method: null };

/**
 * One claimed assignment in one runner process. The trusted runtime must send
 * every new provider/tool step through runStep; this is not a sandbox boundary
 * or durable completion/reassignment authority.
 */
export class RunnerAssignmentLifecycle {
  private readonly identity: SandboxIdentity;
  private readonly client: RunnerLeaseHttpClient;
  private readonly supervisor: LocalSandboxSupervisor;
  private readonly clock: MonotonicClock;
  private readonly timers: LeaseTimerPort | undefined;
  private readonly renewTimeoutMs: number;
  private readonly launchTimeoutMs: number;
  private readonly canLaunch: () => boolean;
  private readonly controller = new AbortController();
  private starting: Promise<void> | null = null;
  private stopping: Promise<StopEvidence> | null = null;
  private gate: RunnerLeaseGate | null = null;
  private loop: RunnerLeaseLoop | null = null;
  private ready = false;
  private closed = false;

  /** Observation only; stop() owns cancellation of this assignment. */
  get signal(): AbortSignal {
    return this.controller.signal;
  }

  constructor(command: RunnerLeaseCommand, options: RunnerAssignmentOptions) {
    const captured = RunnerLeaseCommand.parse(command);
    if (
      typeof options.ownerSubject !== 'string' ||
      !options.ownerSubject.trim()
    ) {
      throw new Error('Runner assignment requires an authenticated owner.');
    }
    this.identity = {
      ...captured.token,
      bootId: captured.bootId,
      ownerSubject: options.ownerSubject,
    };
    this.supervisor = options.supervisor;
    this.clock = options.clock ?? { nowMs: () => performance.now() };
    this.timers = options.timers;
    this.renewTimeoutMs = options.http.timeoutMs;
    this.launchTimeoutMs = options.launchTimeoutMs ?? 10_000;
    this.canLaunch = options.canLaunch ?? (() => true);
    if (
      !Number.isSafeInteger(this.launchTimeoutMs) ||
      this.launchTimeoutMs < 1 ||
      this.launchTimeoutMs > 30_000
    ) {
      throw new Error('Runner launch timeout must be 1-30000 ms.');
    }
    this.client = new RunnerLeaseHttpClient(captured, options.http, this.clock);
  }

  /** Concurrent starts share one activation and launch; a stopped instance never restarts. */
  start(): Promise<void> {
    if (this.closed) {
      return Promise.reject(new Error('Runner assignment was stopped.'));
    }
    this.starting ??= Promise.resolve().then(() => this.activateAndLaunch());
    return this.starting;
  }

  /**
   * Check authority immediately before invoking trusted work. Cancellation is
   * cooperative for in-flight work: preserve its eventual result/evidence for
   * the durable reconciler rather than claiming the remote operation rolled back.
   */
  async runStep<T>(step: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (!this.ready || this.closed || !this.gate) {
      throw new Error('Runner assignment is not active.');
    }
    if (!this.gate.canStartStep()) {
      void this.stop();
      throw new Error('Runner assignment is not active.');
    }
    return step(this.controller.signal);
  }

  /** Fresh coordinator check of durable cancel/fence policy before new external I/O.
   * This renews the existing exact Redis lease; it never extends the local gate.
   */
  async checkAuthority(): Promise<void> {
    try {
      await this.runStep((signal) => this.client.activate(signal));
      await this.runStep(async () => undefined);
    } catch {
      void this.stop();
      throw new Error('Runner assignment authority unavailable.');
    }
  }

  /**
   * Deny new work and abort cooperative operations before local cleanup.
   * Remote lease revocation, durable fencing and effect settlement are separate.
   */
  stop(): Promise<StopEvidence> {
    this.close();
    return this.loop?.stop() ?? this.gate?.stop() ?? this.stopSandbox();
  }

  private async activateAndLaunch(): Promise<void> {
    try {
      if (this.closed) {
        throw new Error('Stopped before activation.');
      }
      const { startedAtMs, ack } = await this.whileOpen(
        this.client.activate(this.controller.signal),
      );
      if (this.closed) {
        throw new Error('Stopped during activation.');
      }
      this.gate = new RunnerLeaseGate(
        this.identity,
        startedAtMs,
        {
          stop: () => {
            this.close();
            return this.stopSandbox();
          },
        },
        this.client,
        this.clock,
        { leaseTtlMs: ack.leaseTtlMs, renewTimeoutMs: this.renewTimeoutMs },
      );
      this.loop = new RunnerLeaseLoop(
        this.gate,
        ack.renewIntervalMs,
        this.timers,
      );
      if (!this.loop.start() || this.closed || !this.gate.canStartStep()) {
        throw new Error('Lease unavailable before launch.');
      }
      const launchStartedAtMs = this.clock.nowMs();
      if (
        !Number.isFinite(launchStartedAtMs) ||
        launchStartedAtMs < startedAtMs
      ) {
        throw new Error('Invalid sandbox launch clock.');
      }
      await this.whileOpen(
        this.supervisor.start(
          { ...this.identity },
          () =>
            !this.closed &&
            this.gate?.canStartStep() === true &&
            this.canLaunch(),
        ),
        this.launchTimeoutMs,
      );
      const launchElapsedMs = this.clock.nowMs() - launchStartedAtMs;
      if (
        this.closed ||
        !this.gate.canStartStep() ||
        !Number.isFinite(launchElapsedMs) ||
        launchElapsedMs < 0 ||
        launchElapsedMs >= this.launchTimeoutMs
      ) {
        throw new Error('Lease unavailable after launch.');
      }
      this.ready = true;
    } catch {
      void this.stop();
      throw new Error('Runner assignment startup failed.');
    }
  }

  /** Cancel startup even when an activation or sandbox driver has not settled. */
  private async whileOpen<T>(work: Promise<T>, timeoutMs?: number): Promise<T> {
    const signal = this.controller.signal;
    if (signal.aborted) {
      void work.catch(() => undefined);
      throw new Error('Runner assignment was stopped.');
    }
    let onAbort!: () => void;
    const stopped = new Promise<never>((_, reject) => {
      onAbort = () => reject(new Error('Runner assignment was stopped.'));
      signal.addEventListener('abort', onAbort, { once: true });
    });
    const candidates = [work, stopped];
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (timeoutMs !== undefined) {
      candidates.push(
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('Runner sandbox launch timed out.')),
            timeoutMs,
          );
        }),
      );
    }
    try {
      return await Promise.race(candidates);
    } finally {
      signal.removeEventListener('abort', onAbort);
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  private close(): void {
    this.closed = true;
    this.ready = false;
    this.controller.abort();
  }

  private stopSandbox(): Promise<StopEvidence> {
    if (!this.stopping) {
      try {
        this.stopping = Promise.resolve(
          this.supervisor.stop({ ...this.identity }),
        ).catch(() => UNCONFIRMED);
      } catch {
        this.stopping = Promise.resolve(UNCONFIRMED);
      }
    }
    return this.stopping;
  }
}
