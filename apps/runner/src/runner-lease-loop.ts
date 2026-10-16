import type { StopEvidence } from './sandbox-supervisor.js';
import { RunnerLeaseGate } from './runner-lease-gate.js';

export interface LeaseTimerPort {
  schedule(callback: () => void, delayMs: number): unknown;
  cancel(handle: unknown): void;
}

const nativeTimers: LeaseTimerPort = {
  schedule: (callback, delayMs) => setTimeout(callback, delayMs),
  cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * Runner-local renewal and expiry watchdog. The gate still has to guard every
 * new provider/tool step; a delayed timer never grants authority by itself.
 */
export class RunnerLeaseLoop {
  private running = false;
  private renewalTimer: unknown | null = null;
  private expiryTimer: unknown | null = null;

  constructor(
    private readonly gate: RunnerLeaseGate,
    private readonly intervalMs = 5_000,
    private readonly timers: LeaseTimerPort = nativeTimers,
  ) {
    if (!Number.isSafeInteger(intervalMs) || intervalMs < 1) {
      throw new Error('Runner lease renewal interval must be positive.');
    }
  }

  start(): boolean {
    if (this.running) {
      if (this.gate.canStartStep()) {
        return true;
      }
      this.running = false;
      this.clearTimers();
      return false;
    }
    if (!this.gate.canStartStep()) {
      return false;
    }
    this.running = true;
    this.schedule();
    return this.running;
  }

  stop(): Promise<StopEvidence> {
    this.running = false;
    const stopping = this.gate.stop();
    this.clearTimers();
    return stopping;
  }

  private schedule(): void {
    this.clearTimers();
    if (!this.running) {
      return;
    }
    const renewIn = this.gate.timeUntilRenewalMs(this.intervalMs);
    const expireIn = this.gate.timeUntilExpiryMs();
    if (renewIn === null || expireIn === null) {
      this.running = false;
      return;
    }
    try {
      this.renewalTimer = this.timers.schedule(() => this.onRenewal(), renewIn);
      this.expiryTimer = this.timers.schedule(() => this.onExpiry(), expireIn);
    } catch {
      this.failClosed();
    }
  }

  private onRenewal(): void {
    this.renewalTimer = null;
    if (!this.running) {
      return;
    }
    void this.gate.renew().then(
      (renewed) => {
        if (!this.running) {
          return;
        }
        if (!renewed) {
          this.running = false;
          this.clearTimers();
          return;
        }
        this.schedule();
      },
      () => {
        void this.stop();
      },
    );
  }

  private onExpiry(): void {
    this.expiryTimer = null;
    if (!this.running) {
      return;
    }
    if (!this.gate.canStartStep()) {
      this.running = false;
      this.clearTimers();
      return;
    }
    // A renewal may have extended the deadline after this timer was armed.
    const expireIn = this.gate.timeUntilExpiryMs();
    if (expireIn === null) {
      this.running = false;
      this.clearTimers();
      return;
    }
    try {
      this.expiryTimer = this.timers.schedule(() => this.onExpiry(), expireIn);
    } catch {
      this.failClosed();
    }
  }

  private failClosed(): void {
    this.running = false;
    void this.gate.stop();
    this.clearTimers();
  }

  private clearTimers(): void {
    if (this.renewalTimer !== null) {
      try {
        this.timers.cancel(this.renewalTimer);
      } catch {
        // A broken timer port cannot reopen the already stopped gate.
      }
      this.renewalTimer = null;
    }
    if (this.expiryTimer !== null) {
      try {
        this.timers.cancel(this.expiryTimer);
      } catch {
        // Stale callbacks check running before doing any renewal.
      }
      this.expiryTimer = null;
    }
  }
}
