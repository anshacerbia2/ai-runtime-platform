import type { UsageCommand } from '@ai-runtime/contracts';
import { randomBytes, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import {
  RunnerHeartbeat,
  type RunnerDispatchGrant,
  type RunnerLeaseCommand,
  type EvidenceReceipt,
} from '@ai-runtime/contracts/http';
import { RunnerAssignmentLifecycle } from './runner-assignment-lifecycle.js';
import { RunnerControlHttpClient } from './runner-control-http-client.js';
import { RunnerDispatchHttpClient } from './runner-dispatch-http-client.js';
import type { RunnerEvidenceCollector } from './runner-evidence-collector.js';
import type {
  RunnerOutcomeBinding,
  RunnerOutcomeJournal,
} from './runner-outcome-journal.js';
import {
  RunnerReportHttpClient,
  type RunnerResultProposal,
} from './runner-report-http-client.js';
import {
  RunnerHttpError,
  type RunnerHttpOptions,
} from './runner-http-transport.js';
import type { MonotonicClock } from './runner-lease-gate.js';
import type { LeaseTimerPort } from './runner-lease-loop.js';
import {
  LocalSandboxSupervisor,
  type SandboxDriver,
  type StopEvidence,
  type TrackedStopResult,
} from './sandbox-supervisor.js';

export interface RunnerDispatchInputs {
  /** Borrowed byte buffers, erased on abort and after callback settlement. */
  readonly payload: Uint8Array;
  readonly plugin: Uint8Array | null;
}

export interface RunnerStepContext {
  readonly signal: AbortSignal;
  runStep<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T>;
  /** Separate quarantined intake remains available after local stop/fence. */
  reportEvidence(
    evidence: UsageCommand,
    signal?: AbortSignal,
  ): Promise<EvidenceReceipt>;
  /** One handoff per assignment; trusted bridge must gate each subsequent I/O. */
  withInputs<T>(
    work: (inputs: RunnerDispatchInputs, signal: AbortSignal) => Promise<T>,
  ): Promise<T>;
}

export interface RunnerWorkerOptions {
  runnerId: string;
  ownerSubject: string;
  registrationRevision: number;
  capacity: number;
  http: RunnerHttpOptions;
  driver: SandboxDriver;
  /** Trusted runtime bridge; every new external dispatch must use context.runStep. */
  runtime: {
    execute(
      grant: RunnerDispatchGrant,
      context: RunnerStepContext,
    ): Promise<void | RunnerResultProposal>;
  };
  maxTracked?: number;
  pollIntervalMs?: number;
  clock?: MonotonicClock;
  timers?: LeaseTimerPort;
  /** Host composition translates SIGTERM/deployment shutdown into this signal. */
  shutdownSignal?: AbortSignal;
  drainGraceMs?: number;
  /** Trusted host owns encrypted storage, replay, key recovery and collector shutdown. */
  evidenceCollector?: RunnerEvidenceCollector;
  /** Separate immutable result/stop evidence; never authorizes retirement or proposal replay. */
  outcomeJournal?: RunnerOutcomeJournal;
}

export interface RunnerWorkerStopResult extends TrackedStopResult {
  /** Local journal persistence only, not a coordinator receipt or termination assertion. */
  durableReceipt?: 'RECORDED' | 'UNAVAILABLE';
}

interface Entry {
  grant: RunnerDispatchGrant;
  command: RunnerLeaseCommand;
  lifecycle: RunnerAssignmentLifecycle;
  task: Promise<void>;
  busy: boolean;
  inputsUsed: boolean;
  runtimeFinished: boolean;
  activeWork: number;
  evidencePending: number;
  stopping: Promise<RunnerWorkerStopResult> | null;
}

const nativeTimers: LeaseTimerPort = {
  schedule: (callback, delayMs) => setTimeout(callback, delayMs),
  cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};
const UNCONFIRMED: StopEvidence = { state: 'UNCONFIRMED', method: null };

/**
 * One registered process boot. Retained assignment tombstones prevent replayed
 * grants from creating new nonces/lifecycles. This is not a durable reconciler.
 */
export class RunnerWorker {
  private readonly processIdentity: RunnerHeartbeat;
  private readonly owner: string;
  private readonly capacity: number;
  private readonly maxTracked: number;
  private readonly pollIntervalMs: number;
  private readonly clock: MonotonicClock;
  private readonly timers: LeaseTimerPort;
  private readonly http: RunnerHttpOptions;
  private readonly runtime: RunnerWorkerOptions['runtime'];
  private readonly control: RunnerControlHttpClient;
  private readonly supervisor: LocalSandboxSupervisor;
  private readonly evidenceCollector: RunnerEvidenceCollector | undefined;
  private readonly outcomeJournal: RunnerOutcomeJournal | undefined;
  private readonly controller = new AbortController();
  private readonly entries = new Map<string, Entry>();
  private state: 'NEW' | 'STARTING' | 'RUNNING' | 'DRAINING' | 'STOPPED' =
    'NEW';
  private starting: Promise<void> | null = null;
  private stopping: Promise<readonly RunnerWorkerStopResult[]> | null = null;
  private draining: Promise<readonly RunnerWorkerStopResult[]> | null = null;
  private heartbeatPending: Promise<void> | null = null;
  private heartbeatTimer: unknown | null = null;
  private claimTimer: unknown | null = null;
  private claimController: AbortController | null = null;
  private polling = false;
  private presenceDeadline = 0;
  private drainDeadline: number | null = null;
  private lastNow = 0;
  private evidencePending = 0;
  private readonly shutdownSignal: AbortSignal | undefined;
  private readonly onShutdown: () => void;

  constructor(options: RunnerWorkerOptions) {
    this.processIdentity = RunnerHeartbeat.parse({
      runnerId: options.runnerId,
      registrationRevision: options.registrationRevision,
      bootId: randomUUID(),
    });
    if (
      typeof options.ownerSubject !== 'string' ||
      !options.ownerSubject.trim()
    ) {
      throw new Error('Runner owner is required.');
    }
    this.capacity = options.capacity;
    this.maxTracked = options.maxTracked ?? 256;
    this.pollIntervalMs = options.pollIntervalMs ?? 1_000;
    if (
      !Number.isSafeInteger(this.capacity) ||
      this.capacity < 1 ||
      !Number.isSafeInteger(this.maxTracked) ||
      this.maxTracked < this.capacity ||
      this.maxTracked > 256 ||
      !Number.isSafeInteger(this.pollIntervalMs) ||
      this.pollIntervalMs < 100 ||
      this.pollIntervalMs > 5_000
    ) {
      throw new Error('Invalid bounded runner capacity or poll interval.');
    }
    this.owner = options.ownerSubject;
    this.clock = options.clock ?? { nowMs: () => performance.now() };
    this.timers = options.timers ?? nativeTimers;
    this.http = { ...options.http };
    this.runtime = options.runtime;
    this.evidenceCollector = options.evidenceCollector;
    this.outcomeJournal = options.outcomeJournal;
    if (
      this.evidenceCollector &&
      !this.evidenceCollector.owns(options.runnerId, this.owner)
    ) {
      throw new Error('Runner evidence collector owner mismatch.');
    }
    if (
      this.outcomeJournal &&
      !this.outcomeJournal.owns(options.runnerId, this.owner)
    ) {
      throw new Error('Runner outcome journal owner mismatch.');
    }
    this.control = new RunnerControlHttpClient(
      this.processIdentity,
      this.owner,
      this.http,
    );
    this.supervisor = new LocalSandboxSupervisor(options.driver);
    const graceMs = options.drainGraceMs ?? 5_000;
    if (!Number.isSafeInteger(graceMs) || graceMs < 0 || graceMs > 30_000) {
      throw new Error('Runner drain grace must be 0-30000 ms.');
    }
    this.shutdownSignal = options.shutdownSignal;
    this.onShutdown = () => {
      try {
        void this.drain(graceMs).catch(() => this.stop());
      } catch {
        void this.stop();
      }
    };
    if (this.shutdownSignal?.aborted) {
      void this.stop();
    } else {
      this.shutdownSignal?.addEventListener('abort', this.onShutdown, {
        once: true,
      });
    }
  }

  get identity(): RunnerHeartbeat {
    return { ...this.processIdentity };
  }

  start(): Promise<void> {
    if (this.state === 'STOPPED' || this.state === 'DRAINING') {
      return Promise.reject(new Error('Runner worker was stopped or drained.'));
    }
    if (!this.starting) {
      this.state = 'STARTING';
      this.starting = Promise.resolve().then(async () => {
        try {
          if (this.controller.signal.aborted) {
            throw new Error();
          }
          if (this.evidenceCollector && !this.evidenceCollector.readyForWork) {
            throw new Error();
          }
          if (this.outcomeJournal && !this.outcomeJournal.canAcceptAssignment) {
            throw new Error();
          }
          await this.heartbeat();
          if (this.controller.signal.aborted) {
            throw new Error();
          }
          if (this.state === 'STARTING') {
            this.state = 'RUNNING';
          }
          this.scheduleClaim(0);
          if (this.controller.signal.aborted) {
            throw new Error();
          }
        } catch {
          void this.stop();
          throw new Error('Runner worker startup failed.');
        }
      });
    }
    return this.starting;
  }

  /** Stop new claims/launches; existing work and heartbeat retain their deadline. */
  quiesce(): void {
    if (this.state === 'STOPPED') {
      return;
    }
    this.state = 'DRAINING';
    this.cancelTimer('claim');
    this.claimController?.abort();
    this.supervisor.quiesce();
  }

  /** One non-extensible grace deadline, then bounded local cleanup. */
  drain(graceMs: number): Promise<readonly RunnerWorkerStopResult[]> {
    if (!Number.isSafeInteger(graceMs) || graceMs < 0 || graceMs > 30_000) {
      throw new Error('Runner drain grace must be 0-30000 ms.');
    }
    if (this.state === 'STOPPED') {
      return this.stop();
    }
    if (!this.draining) {
      this.drainDeadline = this.now() + graceMs;
      this.quiesce();
      this.draining = this.finishDrain(graceMs);
    }
    return this.draining;
  }

  stop(): Promise<readonly RunnerWorkerStopResult[]> {
    if (!this.stopping) {
      let finish!: (results: readonly RunnerWorkerStopResult[]) => void;
      this.stopping = new Promise((resolve) => {
        finish = resolve;
      });
      this.state = 'STOPPED';
      this.shutdownSignal?.removeEventListener('abort', this.onShutdown);
      this.cancelTimer('heartbeat');
      this.cancelTimer('claim');
      this.controller.abort();
      this.claimController?.abort();
      this.supervisor.quiesce();
      void Promise.all(
        [...this.entries.values()].map((entry) => this.stopEntry(entry)),
      ).then(finish);
    }
    return this.stopping;
  }

  private async finishDrain(
    graceMs: number,
  ): Promise<readonly RunnerWorkerStopResult[]> {
    if (this.controller.signal.aborted) {
      return this.stop();
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onStop!: () => void;
    const stopped = new Promise<void>((resolve) => {
      onStop = resolve;
      this.controller.signal.addEventListener('abort', onStop, { once: true });
    });
    try {
      await Promise.race([
        Promise.all([...this.entries.values()].map((entry) => entry.task)),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, graceMs);
        }),
        stopped,
      ]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
      this.controller.signal.removeEventListener('abort', onStop);
    }
    return this.stop();
  }

  private heartbeat(): Promise<void> {
    if (this.heartbeatPending) {
      return this.heartbeatPending;
    }
    const work = this.heartbeatOnce();
    this.heartbeatPending = work;
    const clear = () => {
      if (this.heartbeatPending === work) {
        this.heartbeatPending = null;
      }
    };
    void work.then(clear, clear);
    return work;
  }

  private async heartbeatOnce(): Promise<void> {
    try {
      const sent = this.now();
      this.checkDrain(sent);
      if (this.controller.signal.aborted) {
        throw new Error();
      }
      const ack = await this.control.heartbeat(this.controller.signal);
      const now = this.now();
      if (this.controller.signal.aborted || now >= sent + ack.presenceTtlMs) {
        throw new Error();
      }
      this.presenceDeadline = sent + ack.presenceTtlMs;
      this.cancelTimer('heartbeat');
      if (this.controller.signal.aborted) {
        throw new Error();
      }
      this.heartbeatTimer = this.timers.schedule(
        () => {
          this.heartbeatTimer = null;
          if (this.state !== 'STOPPED') {
            void this.heartbeat().catch(() => undefined);
          }
        },
        Math.max(0, sent + ack.heartbeatIntervalMs - now),
      );
    } catch {
      void this.stop();
      throw new Error('Runner heartbeat failed.');
    }
  }

  private scheduleClaim(delayMs: number): void {
    if (this.state !== 'RUNNING') {
      return;
    }
    this.cancelTimer('claim');
    if (this.controller.signal.aborted) {
      return;
    }
    try {
      this.claimTimer = this.timers.schedule(() => {
        this.claimTimer = null;
        void this.poll();
      }, delayMs);
    } catch {
      void this.stop();
    }
  }

  private async poll(): Promise<void> {
    if (this.state !== 'RUNNING' || this.polling) {
      return;
    }
    this.polling = true;
    try {
      if (
        (this.evidenceCollector && !this.evidenceCollector.readyForWork) ||
        (this.outcomeJournal && !this.outcomeJournal.canAcceptAssignment) ||
        this.entries.size >= this.maxTracked ||
        [...this.entries.values()].filter((entry) => entry.busy).length >=
          this.capacity
      ) {
        return;
      }
      if (this.now() >= this.presenceDeadline) {
        await this.heartbeat();
      }
      if (this.controller.signal.aborted || this.state !== 'RUNNING') {
        return;
      }
      this.claimController = new AbortController();
      const { grant } = await this.control.claim(this.claimController.signal);
      if (
        this.state === 'RUNNING' &&
        !this.claimController.signal.aborted &&
        grant
      ) {
        this.accept(grant);
      }
    } catch (error) {
      // A lost claim ack can be resolved by the next same-boot poll. No nested retry.
      if (
        this.state === 'RUNNING' &&
        (!(error instanceof RunnerHttpError) || error.kind !== 'UNAVAILABLE')
      ) {
        void this.stop();
      }
    } finally {
      this.polling = false;
      this.claimController = null;
      this.scheduleClaim(this.pollIntervalMs);
    }
  }

  private accept(grant: RunnerDispatchGrant): void {
    if (!this.canLaunch()) {
      throw new RunnerHttpError('INVALID');
    }
    const known = this.entries.get(grant.assignmentId);
    if (known) {
      if (JSON.stringify(known.grant) !== JSON.stringify(grant)) {
        throw new RunnerHttpError('INVALID');
      }
      return;
    }
    if (
      [...this.entries.values()].some(
        (entry) =>
          entry.grant.executionId === grant.executionId ||
          entry.grant.attemptId === grant.attemptId,
      )
    ) {
      // Replacement needs durable fencing, effect reconciliation and retirement.
      throw new RunnerHttpError('INVALID');
    }
    if (Date.parse(grant.expiresAt) <= Date.now()) {
      throw new RunnerHttpError('INVALID');
    }
    const command: RunnerLeaseCommand = {
      bootId: this.processIdentity.bootId,
      registrationRevision: this.processIdentity.registrationRevision,
      nonce: randomBytes(32).toString('base64url'),
      token: {
        assignmentId: grant.assignmentId,
        executionId: grant.executionId,
        attemptId: grant.attemptId,
        runnerId: grant.runnerId,
        generation: grant.generation,
        epoch: grant.epoch,
      },
    };
    const lifecycle = new RunnerAssignmentLifecycle(command, {
      ownerSubject: this.owner,
      supervisor: this.supervisor,
      http: this.http,
      clock: this.clock,
      timers: this.timers,
      canLaunch: () => this.canLaunch(),
    });
    this.outcomeJournal?.track(this.outcomeBinding(command));
    const entry: Entry = {
      grant: structuredClone(grant),
      command,
      lifecycle,
      busy: true,
      inputsUsed: false,
      runtimeFinished: false,
      activeWork: 0,
      evidencePending: 0,
      stopping: null,
      task: Promise.resolve(),
    };
    this.entries.set(grant.assignmentId, entry);
    if (this.outcomeJournal) {
      // Renewal/cancel may stop the sandbox while an uncooperative runtime is
      // still pending. Record that observation independently from runtime return.
      lifecycle.signal.addEventListener(
        'abort',
        () => {
          queueMicrotask(() => {
            void this.stopEntry(entry);
          });
        },
        { once: true },
      );
    }
    entry.task = this.execute(entry);
  }

  private async execute(entry: Entry): Promise<void> {
    try {
      if (this.state !== 'RUNNING') {
        throw new Error();
      }
      await entry.lifecycle.start();
      await this.step(entry, (signal) =>
        this.control.reportStarted(entry.command, signal),
      );
      const context: RunnerStepContext = {
        signal: entry.lifecycle.signal,
        runStep: (work) => this.externalStep(entry, work),
        withInputs: (work) => this.withInputs(entry, work),
        reportEvidence: (evidence, signal) =>
          this.reportEvidence(entry, evidence, signal),
      };
      const proposal = await this.step(entry, () =>
        this.runtime.execute(structuredClone(entry.grant), context),
      );
      // Seal retained runtime contexts before any await in result delivery.
      entry.runtimeFinished = true;
      if (proposal !== undefined) {
        if (entry.activeWork !== 0 || entry.evidencePending !== 0) {
          throw new Error();
        }
        // Preserve a validated candidate even if authority was lost during runtime.
        // An append failure denies HTTP; a retained candidate never authorizes replay.
        await this.outcomeJournal?.captureResult(
          this.outcomeBinding(entry.command),
          proposal,
        );
        const reporter = new RunnerReportHttpClient(
          entry.command,
          this.owner,
          this.http,
        );
        await this.step(entry, (signal) => reporter.propose(proposal, signal));
      }
    } catch {
      // Local failure/ambiguity is not an execution outcome or a retry authorization.
    } finally {
      entry.runtimeFinished = true;
      const stopped = await this.stopEntry(entry);
      entry.busy =
        stopped.evidence.state !== 'TERMINATED' ||
        stopped.durableReceipt === 'UNAVAILABLE';
    }
  }

  private outcomeBinding(command: RunnerLeaseCommand): RunnerOutcomeBinding {
    return {
      token: command.token,
      bootId: command.bootId,
      registrationRevision: command.registrationRevision,
    };
  }

  private stopEntry(entry: Entry): Promise<RunnerWorkerStopResult> {
    if (!entry.stopping) {
      let finish!: (result: RunnerWorkerStopResult) => void;
      entry.stopping = new Promise((resolve) => {
        finish = resolve;
      });
      // Seal synchronously before persistence/await; concurrent stop/finally share one receipt.
      let stopping: Promise<StopEvidence>;
      try {
        stopping = entry.lifecycle.stop();
      } catch {
        stopping = Promise.resolve(UNCONFIRMED);
      }
      void (async () => {
        let evidence: StopEvidence;
        try {
          evidence = await stopping;
        } catch {
          evidence = UNCONFIRMED;
        }
        const result: RunnerWorkerStopResult = {
          identity: {
            ...entry.command.token,
            bootId: entry.command.bootId,
            ownerSubject: this.owner,
          },
          evidence,
        };
        if (this.outcomeJournal) {
          try {
            await this.outcomeJournal.recordStop(
              this.outcomeBinding(entry.command),
              evidence,
            );
            result.durableReceipt = 'RECORDED';
          } catch {
            result.durableReceipt = 'UNAVAILABLE';
            this.quiesce();
          }
        }
        entry.busy =
          !entry.runtimeFinished ||
          evidence.state !== 'TERMINATED' ||
          result.durableReceipt === 'UNAVAILABLE';
        finish(result);
      })();
    }
    return entry.stopping;
  }

  private async withInputs<T>(
    entry: Entry,
    work: (inputs: RunnerDispatchInputs, signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    if (entry.inputsUsed || entry.runtimeFinished) {
      void entry.lifecycle.stop();
      throw new Error('Runner dispatch inputs already requested.');
    }
    entry.inputsUsed = true;
    entry.activeWork++;
    const signal = entry.lifecycle.signal;
    let payload: Uint8Array | undefined;
    let plugin: Uint8Array | null = null;
    const erase = () => {
      payload?.fill(0);
      plugin?.fill(0);
    };
    signal.addEventListener('abort', erase, { once: true });
    try {
      const client = new RunnerDispatchHttpClient(
        entry.command,
        entry.grant,
        this.http,
      );
      payload = await this.step(entry, (signal) => client.payload(signal));
      if (entry.grant.plugin) {
        plugin = await this.step(entry, (signal) => client.plugin(signal));
      }
      const inputs: RunnerDispatchInputs = { payload, plugin };
      return await this.step(entry, (signal) => work(inputs, signal));
    } catch {
      void entry.lifecycle.stop();
      throw new Error('Runner dispatch input handoff failed.');
    } finally {
      signal.removeEventListener('abort', erase);
      erase();
      entry.activeWork--;
    }
  }

  private async externalStep<T>(
    entry: Entry,
    work: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    if (entry.runtimeFinished || entry.evidencePending !== 0) {
      if (entry.evidencePending !== 0) {
        void entry.lifecycle.stop();
      }
      throw new Error('Runner runtime dispatch unavailable.');
    }
    entry.activeWork++;
    try {
      await this.step(entry, () => entry.lifecycle.checkAuthority());
      if (entry.runtimeFinished || entry.evidencePending !== 0) {
        if (entry.evidencePending !== 0) {
          void entry.lifecycle.stop();
        }
        throw new Error('Runner runtime dispatch unavailable.');
      }
      return await this.step(entry, work);
    } finally {
      entry.activeWork--;
    }
  }

  private async reportEvidence(
    entry: Entry,
    evidence: UsageCommand,
    signal?: AbortSignal,
  ): Promise<EvidenceReceipt> {
    // Optional trusted collector persists before delivery. Without it, the
    // bridge still owns durable retention of failed/ambiguous evidence.
    if (this.evidencePending >= 8) {
      void entry.lifecycle.stop();
      throw new Error('Runner evidence concurrency limit reached.');
    }
    this.evidencePending++;
    entry.evidencePending++;
    try {
      if (this.evidenceCollector) {
        return await this.evidenceCollector.report(
          { token: entry.command.token, evidence },
          signal,
        );
      }
      return await new RunnerReportHttpClient(
        entry.command,
        this.owner,
        this.http,
      ).evidence(evidence, signal);
    } catch {
      void entry.lifecycle.stop();
      throw new Error('Runner evidence delivery unavailable.');
    } finally {
      this.evidencePending--;
      entry.evidencePending--;
    }
  }

  private async step<T>(
    entry: Entry,
    work: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const now = this.now();
    this.checkDrain(now);
    if (this.state === 'STOPPED' || now >= this.presenceDeadline) {
      void this.stop();
      throw new Error('Runner process authority unavailable.');
    }
    if (this.evidenceCollector && !this.evidenceCollector.readyForWork) {
      void entry.lifecycle.stop();
      throw new Error('Runner evidence collection unavailable.');
    }
    if (this.outcomeJournal && !this.outcomeJournal.readyForWork) {
      void entry.lifecycle.stop();
      throw new Error('Runner outcome journal unavailable.');
    }
    return entry.lifecycle.runStep(work);
  }

  private checkDrain(now: number): void {
    if (this.drainDeadline !== null && now >= this.drainDeadline) {
      void this.stop();
      throw new Error('Runner drain deadline expired.');
    }
  }

  private canLaunch(): boolean {
    if (
      this.state !== 'RUNNING' ||
      (this.outcomeJournal && !this.outcomeJournal.readyForWork) ||
      (this.evidenceCollector && !this.evidenceCollector.readyForWork)
    ) {
      return false;
    }
    const now = this.now();
    this.checkDrain(now);
    if (now >= this.presenceDeadline) {
      void this.stop();
      return false;
    }
    return true;
  }

  private now(): number {
    let now: number;
    try {
      now = this.clock.nowMs();
    } catch {
      void this.stop();
      throw new Error('Runner clock failed.');
    }
    if (!Number.isFinite(now) || now < this.lastNow) {
      void this.stop();
      throw new Error('Runner clock failed.');
    }
    this.lastNow = now;
    return now;
  }

  private cancelTimer(kind: 'heartbeat' | 'claim'): void {
    const timer = kind === 'heartbeat' ? this.heartbeatTimer : this.claimTimer;
    if (kind === 'heartbeat') {
      this.heartbeatTimer = null;
    } else {
      this.claimTimer = null;
    }
    if (timer !== null) {
      try {
        this.timers.cancel(timer);
      } catch {
        if (this.state !== 'STOPPED') {
          void this.stop();
        }
      }
    }
  }
}
