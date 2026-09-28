import type { RunnerRegistrationIdentity } from '../application/runner-liveness-registry.port.js';
import type {
  RunnerPresenceMatch,
  RunnerPresenceProof,
  RunnerPresenceStore,
} from '../application/runner-presence-store.port.js';
import {
  assertRunnerPresenceTtl,
  encodeRunnerPresence,
  runnerPresenceIdentity,
  runnerPresenceKey,
} from './runner-presence-proof.js';

interface PresenceEntry {
  value: string;
  expiresAt: number;
}

export class InMemoryRunnerPresenceStore implements RunnerPresenceStore {
  private readonly entries = new Map<string, PresenceEntry>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly prefix = 'ai-runtime:m3:runner-presence',
  ) {}

  async heartbeat(proof: RunnerPresenceProof, ttlMs: number): Promise<void> {
    assertRunnerPresenceTtl(ttlMs);
    this.entries.set(runnerPresenceKey(this.prefix, proof), {
      value: encodeRunnerPresence(proof),
      expiresAt: this.now() + ttlMs,
    });
  }

  async inspect(
    registration: RunnerRegistrationIdentity,
  ): Promise<RunnerPresenceMatch> {
    const key = runnerPresenceKey(this.prefix, registration);
    const entry = this.entries.get(key);
    if (!entry || entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return 'MISSING';
    }
    return entry.value.startsWith(`${runnerPresenceIdentity(registration)}:`)
      ? 'CURRENT'
      : 'MISMATCH';
  }
}
