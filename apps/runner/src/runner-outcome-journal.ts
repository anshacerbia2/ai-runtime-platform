import { createHash } from 'node:crypto';
import {
  RunnerOutcomeBinding,
  RunnerStopEvidence,
  RunnerReport,
} from '@ai-runtime/contracts/http';
import type {
  EvidenceCipher,
  EvidenceSpool,
} from './runner-evidence-collector.js';
import type { RunnerResultProposal } from './runner-report-http-client.js';
import type { StopEvidence } from './sandbox-supervisor.js';

export type { RunnerOutcomeBinding } from '@ai-runtime/contracts/http';

export type RunnerOutcomeRecord =
  | {
      version: 1;
      type: 'result.candidate';
      binding: RunnerOutcomeBinding;
      proposal: RunnerResultProposal;
    }
  | {
      version: 1;
      type: 'local.stop';
      binding: RunnerOutcomeBinding;
      evidence: StopEvidence;
    };

export interface RunnerOutcomeJournalOptions {
  runnerId: string;
  ownerSubject: string;
  /** Dedicated store/ownership; do not share a namespace with the usage collector. */
  spool: EvidenceSpool & {
    readonly limits: { maxRecords: number; maxBytes: number };
  };
  cipher: EvidenceCipher;
  maxAssignments: number;
  timeoutMs: number;
}

const MAX_BYTES = 65_536;
const failure = () => new Error('Runner outcome journal unavailable.');
const digest = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

function object(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(',') !== [...keys].sort().join(',')
  ) {
    throw failure();
  }
  return value as Record<string, unknown>;
}

function bindingOf(input: unknown): RunnerOutcomeBinding {
  return RunnerOutcomeBinding.parse(input);
}

function stopOf(input: unknown): StopEvidence {
  return RunnerStopEvidence.parse(input);
}

/** Immutable local evidence, not coordinator authority, retirement or a proposal retry queue. */
export class RunnerOutcomeJournal {
  private readonly bindings = new Map<string, RunnerOutcomeBinding>();
  private readonly stored = new Set<string>();
  private readonly active = new Set<string>();
  private poisoned = false;
  private recovered = false;

  private constructor(private readonly options: RunnerOutcomeJournalOptions) {
    const { maxAssignments, timeoutMs, spool } = options;
    if (
      !options.runnerId.trim() ||
      !options.ownerSubject.trim() ||
      !Number.isSafeInteger(maxAssignments) ||
      maxAssignments < 1 ||
      maxAssignments > 128 ||
      !Number.isSafeInteger(timeoutMs) ||
      timeoutMs < 100 ||
      timeoutMs > 3000 ||
      !Number.isSafeInteger(spool.limits.maxRecords) ||
      spool.limits.maxRecords > 256 ||
      spool.limits.maxRecords < maxAssignments * 2 ||
      !Number.isSafeInteger(spool.limits.maxBytes) ||
      spool.limits.maxBytes > 16_777_216 ||
      spool.limits.maxBytes < maxAssignments * 2 * MAX_BYTES
    ) {
      throw failure();
    }
  }

  static async open(
    options: RunnerOutcomeJournalOptions,
  ): Promise<RunnerOutcomeJournal> {
    try {
      const journal = new RunnerOutcomeJournal({ ...options });
      const ids = options.spool.ids();
      if (
        ids.length > options.maxAssignments * 2 ||
        new Set(ids).size !== ids.length
      ) {
        throw failure();
      }
      for (const id of ids) {
        const record = await journal.decode(id);
        journal.register(record.binding);
        journal.stored.add(id);
      }
      journal.recovered = ids.length !== 0;
      return journal;
    } catch {
      throw failure();
    }
  }

  get readyForWork(): boolean {
    return !this.poisoned && !this.recovered;
  }

  get canAcceptAssignment(): boolean {
    return (
      this.readyForWork && this.bindings.size < this.options.maxAssignments
    );
  }

  owns(runnerId: string, ownerSubject: string): boolean {
    return (
      runnerId === this.options.runnerId &&
      ownerSubject === this.options.ownerSubject
    );
  }

  /** Reserve two maximum-size records before launch; retained identities are never evicted. */
  track(input: RunnerOutcomeBinding): void {
    try {
      if (!this.readyForWork) {
        throw failure();
      }
      this.register(this.validateBinding(input));
    } catch {
      throw failure();
    }
  }

  ids(): readonly string[] {
    return [...this.stored];
  }

  async read(id: string): Promise<RunnerOutcomeRecord> {
    try {
      if (!this.stored.has(id)) {
        throw failure();
      }
      return await this.decode(id);
    } catch {
      this.poisoned = true;
      throw failure();
    }
  }

  async captureResult(
    input: RunnerOutcomeBinding,
    proposal: RunnerResultProposal,
  ): Promise<void> {
    let record: RunnerOutcomeRecord;
    try {
      const binding = this.validateBinding(input);
      const report = RunnerReport.parse({
        type: 'result.proposed',
        token: binding.token,
        proposal,
      });
      if (report.type !== 'result.proposed') {
        throw failure();
      }
      record = {
        version: 1,
        type: 'result.candidate',
        binding,
        proposal: report.proposal,
      };
    } catch {
      throw failure();
    }
    await this.append(record);
  }

  async recordStop(
    input: RunnerOutcomeBinding,
    evidence: StopEvidence,
  ): Promise<void> {
    let record: RunnerOutcomeRecord;
    try {
      record = {
        version: 1,
        type: 'local.stop',
        binding: this.validateBinding(input),
        evidence: stopOf(evidence),
      };
    } catch {
      throw failure();
    }
    await this.append(record);
  }

  private validateBinding(input: unknown): RunnerOutcomeBinding {
    const binding = bindingOf(input);
    if (binding.token.runnerId !== this.options.runnerId) {
      throw failure();
    }
    return binding;
  }

  private register(binding: RunnerOutcomeBinding): void {
    const known = this.bindings.get(binding.token.assignmentId);
    if (known) {
      if (JSON.stringify(known) !== JSON.stringify(binding)) {
        throw failure();
      }
      return;
    }
    if (
      this.bindings.size >= this.options.maxAssignments ||
      [...this.bindings.values()].some(
        (other) =>
          other.token.executionId === binding.token.executionId ||
          other.token.attemptId === binding.token.attemptId,
      )
    ) {
      throw failure();
    }
    this.bindings.set(binding.token.assignmentId, binding);
  }

  private id(record: RunnerOutcomeRecord): string {
    return digest([record.type, record.binding]);
  }
  private context(id: string): string {
    return JSON.stringify([
      'runner-outcome-journal-v1',
      this.options.runnerId,
      this.options.ownerSubject,
      id,
    ]);
  }

  private async append(record: RunnerOutcomeRecord): Promise<void> {
    const id = this.id(record);
    const known = this.bindings.get(record.binding.token.assignmentId);
    if (
      this.poisoned ||
      this.active.has(id) ||
      !known ||
      JSON.stringify(known) !== JSON.stringify(record.binding)
    ) {
      throw failure();
    }
    this.active.add(id);
    try {
      if (this.stored.has(id)) {
        if (JSON.stringify(await this.decode(id)) !== JSON.stringify(record)) {
          throw failure();
        }
        return;
      }
      const plaintext = Buffer.from(JSON.stringify(record));
      try {
        if (plaintext.length > MAX_BYTES) {
          throw failure();
        }
        const ciphertext = await this.bounded(
          this.options.cipher.seal(plaintext, this.context(id)),
        );
        try {
          if (ciphertext.length < 1 || ciphertext.length > MAX_BYTES) {
            throw failure();
          }
          this.options.spool.put(id, ciphertext);
          this.stored.add(id);
        } finally {
          ciphertext.fill(0);
        }
      } finally {
        plaintext.fill(0);
      }
    } catch {
      this.poisoned = true;
      throw failure();
    } finally {
      this.active.delete(id);
    }
  }

  private async decode(id: string): Promise<RunnerOutcomeRecord> {
    if (!/^[a-f0-9]{64}$/.test(id)) {
      throw failure();
    }
    const ciphertext = this.options.spool.read(id);
    let plaintext: Uint8Array | undefined;
    try {
      if (ciphertext.length < 1 || ciphertext.length > MAX_BYTES) {
        throw failure();
      }
      plaintext = await this.bounded(
        this.options.cipher.open(ciphertext, this.context(id)),
      );
      if (plaintext.length < 1 || plaintext.length > MAX_BYTES) {
        throw failure();
      }
      const input: unknown = JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(plaintext),
      );
      const kind =
        input && typeof input === 'object' && 'type' in input
          ? input.type
          : null;
      const value = object(input, [
        'version',
        'type',
        'binding',
        kind === 'result.candidate' ? 'proposal' : 'evidence',
      ]);
      if (value.version !== 1) {
        throw failure();
      }
      const binding = this.validateBinding(value.binding);
      let record: RunnerOutcomeRecord;
      if (value.type === 'result.candidate') {
        const report = RunnerReport.parse({
          type: 'result.proposed',
          token: binding.token,
          proposal: value.proposal,
        });
        if (report.type !== 'result.proposed') {
          throw failure();
        }
        record = {
          version: 1,
          type: 'result.candidate',
          binding,
          proposal: report.proposal,
        };
      } else if (value.type === 'local.stop') {
        record = {
          version: 1,
          type: 'local.stop',
          binding,
          evidence: stopOf(value.evidence),
        };
      } else {
        throw failure();
      }
      if (this.id(record) !== id) {
        throw failure();
      }
      return record;
    } finally {
      ciphertext.fill(0);
      plaintext?.fill(0);
    }
  }

  private async bounded(work: Promise<Uint8Array>): Promise<Uint8Array> {
    let finished = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        work.then((bytes) => {
          if (finished) {
            bytes.fill(0);
            throw failure();
          }
          return bytes;
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(failure()), this.options.timeoutMs);
        }),
      ]);
    } finally {
      finished = true;
      clearTimeout(timer);
    }
  }
}
