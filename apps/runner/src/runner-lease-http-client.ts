import { performance } from 'node:perf_hooks';
import {
  apiContract,
  RunnerLeaseAck,
  RunnerLeaseCommand,
} from '@ai-runtime/contracts/http';
import type { LeaseRenewalPort, MonotonicClock } from './runner-lease-gate.js';
import {
  RunnerHttpTransport,
  type RunnerHttpOptions,
} from './runner-http-transport.js';

export type RunnerLeaseHttpOptions = RunnerHttpOptions;

/** One exact lease command; no redirect or automatic retry on ambiguous outcome. */
export class RunnerLeaseHttpClient implements LeaseRenewalPort {
  private readonly command: RunnerLeaseCommand;
  private readonly transport: RunnerHttpTransport;

  constructor(
    command: RunnerLeaseCommand,
    options: RunnerLeaseHttpOptions,
    private readonly clock: MonotonicClock = { nowMs: () => performance.now() },
  ) {
    this.command = RunnerLeaseCommand.parse(command);
    this.transport = new RunnerHttpTransport(options);
  }

  /** Pass startedAtMs and the same clock to RunnerLeaseGate after this succeeds. */
  async activate(
    signal?: AbortSignal,
  ): Promise<{ startedAtMs: number; ack: RunnerLeaseAck }> {
    const startedAtMs = this.clock.nowMs();
    if (!Number.isFinite(startedAtMs) || startedAtMs < 0) {
      throw new Error('Runner lease clock is invalid.');
    }
    try {
      const ack = RunnerLeaseAck.parse(
        await this.transport.post(
          apiContract.runner.activateLease.path,
          this.command,
          signal,
        ),
      );
      return { startedAtMs, ack };
    } catch {
      throw new Error('Runner lease activation failed.');
    }
  }

  async renew(): Promise<void> {
    await this.activate();
  }
}
