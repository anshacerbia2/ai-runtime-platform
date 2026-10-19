/** Local process identity; durable assignment authority remains in PostgreSQL. */
export interface SandboxIdentity {
  assignmentId: string;
  executionId: string;
  attemptId: string;
  runnerId: string;
  ownerSubject: string;
  bootId: string;
  generation: number;
  epoch: number;
}

/** Implemented by the approved out-of-process sandbox, not by plugin code. */
export interface SandboxHandle {
  requestStop(): Promise<void>;
  forceStop(): Promise<void>;
  /** Must inspect the entire owned sandbox/process tree. */
  inspect(): Promise<'EXITED' | 'RUNNING' | 'UNKNOWN'>;
}

export interface SandboxDriver {
  /** A deterministic assignment ID must make launch idempotent across retries. */
  launch(
    identity: SandboxIdentity,
    guard?: SandboxLaunchGuard,
  ): Promise<SandboxHandle>;
  /** Discover an existing sandbox after supervisor restart; return its recorded binding. */
  recover(identity: SandboxIdentity): Promise<RecoveredSandbox | null>;
}

export interface SandboxLaunchGuard {
  /** Recheck synchronously at spawn after any asynchronous host preparation. */
  canLaunch(): boolean;
}

export interface RecoveredSandbox {
  identity: SandboxIdentity;
  handle: SandboxHandle;
}

export interface StopEvidence {
  state: 'TERMINATED' | 'UNCONFIRMED';
  method: 'GRACEFUL' | 'FORCED' | 'OBSERVED' | null;
}

export interface TrackedStopResult {
  identity: SandboxIdentity;
  evidence: StopEvidence;
}

interface Entry {
  identity: SandboxIdentity;
  started: Promise<SandboxHandle> | null;
  stopping: Promise<StopEvidence> | null;
}

const UNCONFIRMED: StopEvidence = { state: 'UNCONFIRMED', method: null };
const MAX_TRACKED_ASSIGNMENTS = 256;

function assertIdentity(identity: SandboxIdentity): void {
  if (
    !identity.assignmentId ||
    !identity.executionId ||
    !identity.attemptId ||
    !identity.runnerId ||
    !identity.ownerSubject ||
    !identity.bootId ||
    !Number.isSafeInteger(identity.generation) ||
    identity.generation < 1 ||
    !Number.isSafeInteger(identity.epoch) ||
    identity.epoch < 1
  ) {
    throw new Error('Sandbox assignment identity is invalid.');
  }
}

function sameIdentity(a: SandboxIdentity, b: SandboxIdentity): boolean {
  return (
    a.assignmentId === b.assignmentId &&
    a.executionId === b.executionId &&
    a.attemptId === b.attemptId &&
    a.runnerId === b.runnerId &&
    a.ownerSubject === b.ownerSubject &&
    a.bootId === b.bootId &&
    a.generation === b.generation &&
    a.epoch === b.epoch
  );
}

async function within<T>(
  work: Promise<T>,
  timeoutMs: number,
): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work.catch(() => null),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

/**
 * One-process local stop coordinator. No sandbox technology, durable stop receipt,
 * external-effect conclusion, or reassignment authority is implied by this class.
 */
export class LocalSandboxSupervisor {
  private readonly entries = new Map<string, Entry>();
  private quiesced: SandboxIdentity[] | null = null;
  private trackedStop: Promise<readonly TrackedStopResult[]> | null = null;

  constructor(
    private readonly driver: SandboxDriver,
    private readonly deadlines = {
      launchMs: 10_000,
      gracefulMs: 5_000,
      forceMs: 2_000,
    },
  ) {
    for (const value of Object.values(deadlines)) {
      if (!Number.isSafeInteger(value) || value < 1 || value > 30_000) {
        throw new Error('Sandbox supervisor deadlines must be 1-30000 ms.');
      }
    }
  }

  start(
    identity: SandboxIdentity,
    /** Recheck local authority at the queued driver call, not only at enqueue. */
    canLaunch?: () => boolean,
  ): Promise<SandboxHandle> {
    assertIdentity(identity);
    if (this.quiesced) {
      throw new Error('Sandbox supervisor is draining.');
    }
    const current = this.entries.get(identity.assignmentId);
    if (current) {
      if (!sameIdentity(current.identity, identity)) {
        throw new Error('Sandbox assignment identity mismatch.');
      }
      if (current.stopping || !current.started) {
        throw new Error('Sandbox assignment was stopped.');
      }
      return this.deliverStarted(current);
    }
    if (this.entries.size >= MAX_TRACKED_ASSIGNMENTS) {
      throw new Error('Local sandbox supervisor capacity is exhausted.');
    }
    const captured = { ...identity };
    const entry: Entry = {
      identity: captured,
      started: null,
      stopping: null,
    };
    this.entries.set(captured.assignmentId, entry);
    entry.started = Promise.resolve().then(() => {
      if (this.quiesced) {
        throw new Error('Sandbox supervisor is draining.');
      }
      if (entry.stopping) {
        throw new Error('Sandbox assignment was stopped.');
      }
      if (canLaunch && !canLaunch()) {
        throw new Error('Sandbox launch authority was lost.');
      }
      return this.driver.launch(
        { ...captured },
        {
          canLaunch: () =>
            !this.quiesced && !entry.stopping && (!canLaunch || canLaunch()),
        },
      );
    });
    return this.deliverStarted(entry);
  }

  /** Stop admitting launches; existing work keeps its caller-owned deadline. */
  quiesce(): readonly SandboxIdentity[] {
    if (!this.quiesced) {
      this.quiesced = [...this.entries.values()].map((entry) => ({
        ...entry.identity,
      }));
    }
    return this.quiesced.map((identity) => ({ ...identity }));
  }

  /** Explicit cleanup after cancellation or the caller's in-flight deadline. */
  stopTracked(): Promise<readonly TrackedStopResult[]> {
    if (!this.trackedStop) {
      const snapshot = this.quiesce();
      this.trackedStop = Promise.all(
        snapshot.map(async (identity) => ({
          identity,
          evidence: await this.stop(identity),
        })),
      );
    }
    return this.trackedStop;
  }

  private async deliverStarted(entry: Entry): Promise<SandboxHandle> {
    if (!entry.started) {
      throw new Error('Sandbox assignment was stopped.');
    }
    const handle = await entry.started;
    if (entry.stopping) {
      throw new Error('Sandbox assignment was stopped.');
    }
    return handle;
  }

  stop(identity: SandboxIdentity): Promise<StopEvidence> {
    assertIdentity(identity);
    let entry = this.entries.get(identity.assignmentId);
    if (!entry) {
      if (this.entries.size >= MAX_TRACKED_ASSIGNMENTS) {
        throw new Error('Local sandbox supervisor capacity is exhausted.');
      }
      // Seal first, then discover a possible sandbox left by an earlier process.
      entry = { identity: { ...identity }, started: null, stopping: null };
      this.entries.set(identity.assignmentId, entry);
    }
    if (!sameIdentity(entry.identity, identity)) {
      throw new Error('Sandbox assignment identity mismatch.');
    }
    if (!entry.stopping) {
      entry.stopping = entry.started
        ? this.stopStarted(entry.identity, entry.started)
        : this.stopRecovered(entry.identity);
    }
    return entry.stopping;
  }

  private async stopStarted(
    identity: SandboxIdentity,
    started: Promise<SandboxHandle>,
  ): Promise<StopEvidence> {
    const handle = await within(started, this.deadlines.launchMs);
    if (!handle) {
      // A late launch is still asked to stop, but cannot certify this stop call.
      void started
        .then(
          (late) => this.terminate(late),
          () => this.stopRecovered(identity),
        )
        .catch(() => {});
      return UNCONFIRMED;
    }
    return this.terminate(handle);
  }

  private async stopRecovered(
    identity: SandboxIdentity,
  ): Promise<StopEvidence> {
    const lookup = Promise.resolve().then(() =>
      this.driver.recover({ ...identity }),
    );
    const recovered = await within(lookup, this.deadlines.launchMs);
    if (!recovered) {
      // A slow lookup may still locate an old sandbox after this call expires.
      void lookup
        .then((late) =>
          late && sameIdentity(late.identity, identity)
            ? this.terminate(late.handle)
            : undefined,
        )
        .catch(() => {});
      return UNCONFIRMED;
    }
    if (!sameIdentity(recovered.identity, identity)) {
      return UNCONFIRMED;
    }
    return this.terminate(recovered.handle);
  }

  private async terminate(handle: SandboxHandle): Promise<StopEvidence> {
    const graceful = await within(
      Promise.resolve().then(() => handle.requestStop()),
      this.deadlines.gracefulMs,
    );
    if (
      (await within(
        Promise.resolve().then(() => handle.inspect()),
        this.deadlines.gracefulMs,
      )) === 'EXITED'
    ) {
      return {
        state: 'TERMINATED',
        method: graceful === null ? 'OBSERVED' : 'GRACEFUL',
      };
    }
    const forced = await within(
      Promise.resolve().then(() => handle.forceStop()),
      this.deadlines.forceMs,
    );
    if (
      (await within(
        Promise.resolve().then(() => handle.inspect()),
        this.deadlines.forceMs,
      )) === 'EXITED'
    ) {
      return {
        state: 'TERMINATED',
        method: forced === null ? 'OBSERVED' : 'FORCED',
      };
    }
    return UNCONFIRMED;
  }
}
