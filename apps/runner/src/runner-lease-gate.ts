import { performance } from 'node:perf_hooks';
import type {
  LocalSandboxSupervisor,
  SandboxIdentity,
  StopEvidence,
} from './sandbox-supervisor.js';

export interface LeaseRenewalPort {
  /** Bound by the caller to one exact boot, assignment, generation, epoch and nonce. */
  renew(): Promise<void>;
}

export interface MonotonicClock {
  nowMs(): number;
}

const UNCONFIRMED: StopEvidence = { state: 'UNCONFIRMED', method: null };

/**
 * Runner-local gate for new provider/tool steps. The caller must check this before
 * every new step and schedule renewal; a timer or stopped process alone is not
 * a durable authority fence. A lost gate cannot be reopened by a late response.
 */
export class RunnerLeaseGate {
  private readonly identity: SandboxIdentity;
  private expiresAtMs: number;
  private lastNowMs: number;
  private lost = false;
  private pendingRenewal: Promise<boolean> | null = null;
  private stopping: Promise<StopEvidence> | null = null;

  constructor(
    identity: SandboxIdentity,
    /** Monotonic timestamp captured before the successful initial activation request. */
    initialActivationStartedAtMs: number,
    private readonly supervisor: Pick<LocalSandboxSupervisor, 'stop'>,
    private readonly renewal: LeaseRenewalPort,
    private readonly clock: MonotonicClock = { nowMs: () => performance.now() },
    private readonly policy = { leaseTtlMs: 15_000, renewTimeoutMs: 3_000 },
  ) {
    for (const value of Object.values(policy)) {
      if (!Number.isSafeInteger(value) || value < 1 || value > 30_000) {
        throw new Error('Runner lease gate deadlines must be 1-30000 ms.');
      }
    }
    const now = clock.nowMs();
    if (
      !Number.isFinite(now) ||
      !Number.isFinite(initialActivationStartedAtMs) ||
      initialActivationStartedAtMs < 0 ||
      initialActivationStartedAtMs > now ||
      now >= initialActivationStartedAtMs + policy.leaseTtlMs
    ) {
      throw new Error('Runner lease gate needs a valid activation deadline.');
    }
    this.identity = { ...identity };
    this.lastNowMs = now;
    this.expiresAtMs = initialActivationStartedAtMs + policy.leaseTtlMs;
  }

  canStartStep(): boolean {
    if (this.lost) {
      return false;
    }
    const now = this.readNow();
    if (now >= this.expiresAtMs) {
      void this.stop();
      return false;
    }
    return true;
  }

  renew(): Promise<boolean> {
    if (!this.canStartStep()) {
      return Promise.resolve(false);
    }
    if (this.pendingRenewal) {
      return this.pendingRenewal;
    }
    const pending = this.renewOnce(this.lastNowMs);
    this.pendingRenewal = pending;
    void pending.then(() => {
      if (this.pendingRenewal === pending) {
        this.pendingRenewal = null;
      }
    });
    return pending;
  }

  private async renewOnce(sentAtMs: number): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const work = Promise.resolve().then(() => this.renewal.renew());
    try {
      const acknowledged = await Promise.race([
        work.then(
          () => true,
          () => false,
        ),
        new Promise<boolean>((resolve) => {
          timer = setTimeout(() => resolve(false), this.policy.renewTimeoutMs);
        }),
      ]);
      if (!acknowledged) {
        void this.stop();
        return false;
      }
      const now = this.readNow();
      const nextExpiresAtMs = sentAtMs + this.policy.leaseTtlMs;
      if (this.lost || now >= this.expiresAtMs || now >= nextExpiresAtMs) {
        void this.stop();
        return false;
      }
      this.expiresAtMs = nextExpiresAtMs;
      return true;
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  private readNow(): number {
    let now: number;
    try {
      now = this.clock.nowMs();
    } catch {
      void this.stop();
      return Number.POSITIVE_INFINITY;
    }
    if (!Number.isFinite(now) || now < this.lastNowMs) {
      void this.stop();
      return Number.POSITIVE_INFINITY;
    }
    this.lastNowMs = now;
    return now;
  }

  /** Cancel, fence or lease loss: deny new steps before asking for local cleanup. */
  stop(): Promise<StopEvidence> {
    this.lost = true;
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

  stopEvidence(): Promise<StopEvidence> | null {
    return this.stopping;
  }
}
