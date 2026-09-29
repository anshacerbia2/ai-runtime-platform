import type {
  RunnerLeaseInstallResult,
  RunnerLeaseMatchResult,
  RunnerLeaseProof,
  RunnerLeaseDurableProof,
  RunnerLeaseReleaseResult,
  RunnerLeaseRenewResult,
  RunnerLeaseStore,
} from '../application/runner-lease-store.port.js';
import {
  assertRunnerLeaseTtl,
  encodeRunnerLeaseProof,
  matchDurableRunnerLease,
  runnerLeaseKey,
} from './runner-lease-proof.js';

interface LeaseEntry {
  value: string;
  expiresAt: number;
}

/** Deterministic local reference for the Redis lease semantics. */
export class InMemoryRunnerLeaseStore implements RunnerLeaseStore {
  private readonly leases = new Map<string, LeaseEntry>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly prefix = 'ai-runtime:m3:lease',
  ) {}

  private current(proof: Pick<RunnerLeaseProof, 'executionId'>) {
    const key = runnerLeaseKey(this.prefix, proof);
    const entry = this.leases.get(key);
    if (entry && entry.expiresAt <= this.now()) {
      this.leases.delete(key);
      return { key, entry: undefined };
    }
    return { key, entry };
  }

  async install(
    proof: RunnerLeaseProof,
    ttlMs: number,
  ): Promise<RunnerLeaseInstallResult> {
    assertRunnerLeaseTtl(ttlMs);
    const value = encodeRunnerLeaseProof(proof);
    const { key, entry } = this.current(proof);
    if (entry && entry.value !== value) {
      return 'CONFLICT';
    }
    this.leases.set(key, { value, expiresAt: this.now() + ttlMs });
    return entry ? 'REFRESHED' : 'INSTALLED';
  }

  async inspect(proof: RunnerLeaseProof): Promise<RunnerLeaseMatchResult> {
    const value = encodeRunnerLeaseProof(proof);
    const { entry } = this.current(proof);
    return !entry ? 'MISSING' : entry.value === value ? 'CURRENT' : 'MISMATCH';
  }

  async inspectDurable(
    proof: RunnerLeaseDurableProof,
  ): Promise<RunnerLeaseMatchResult> {
    const { entry } = this.current(proof);
    return matchDurableRunnerLease(entry?.value ?? null, proof);
  }

  async renew(
    proof: RunnerLeaseProof,
    ttlMs: number,
  ): Promise<RunnerLeaseRenewResult> {
    assertRunnerLeaseTtl(ttlMs);
    const value = encodeRunnerLeaseProof(proof);
    const { key, entry } = this.current(proof);
    if (!entry) {
      return 'MISSING';
    }
    if (entry.value !== value) {
      return 'MISMATCH';
    }
    entry.expiresAt = this.now() + ttlMs;
    this.leases.set(key, entry);
    return 'RENEWED';
  }

  async release(proof: RunnerLeaseProof): Promise<RunnerLeaseReleaseResult> {
    const value = encodeRunnerLeaseProof(proof);
    const { key, entry } = this.current(proof);
    if (!entry) {
      return 'MISSING';
    }
    if (entry.value !== value) {
      return 'MISMATCH';
    }
    this.leases.delete(key);
    return 'RELEASED';
  }
}
