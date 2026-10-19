import { createHash } from 'node:crypto';
import {
  apiContract,
  EvidenceReceipt,
  LateEvidence,
} from '@ai-runtime/contracts/http';
import {
  RunnerHttpTransport,
  type RunnerHttpOptions,
} from './runner-http-transport.js';

/** Single trusted collector owns this bounded store; successful put/remove are durable. */
export interface EvidenceSpool {
  ids(): readonly string[];
  read(id: string): Uint8Array;
  put(id: string, ciphertext: Uint8Array): void;
  remove(id: string): void;
}

/** Host supplies authenticated encryption, wrapped-key metadata and key recovery. No default key. */
export interface EvidenceCipher {
  seal(plaintext: Uint8Array, context: string): Promise<Uint8Array>;
  open(ciphertext: Uint8Array, context: string): Promise<Uint8Array>;
}

export interface RunnerEvidenceCollectorOptions {
  runnerId: string;
  ownerSubject: string;
  spool: EvidenceSpool;
  cipher: EvidenceCipher;
  http: RunnerHttpOptions;
}

const MAX_RECORD_BYTES = 65_536;
const MAX_RECORDS = 256;
const failure = () => new Error('Evidence collection unavailable.');
const hash = (text: string) => createHash('sha256').update(text).digest('hex');

/** Late quarantine intake only. Never retries runtime, proposals, settlement or paid I/O. */
export class RunnerEvidenceCollector {
  private readonly transport: RunnerHttpTransport;
  private readonly pending = new Set<string>();
  private readonly active = new Set<string>();
  private poisoned = false;
  private flushing = false;

  private constructor(
    private readonly options: RunnerEvidenceCollectorOptions,
  ) {
    if (!options.runnerId.trim() || !options.ownerSubject.trim()) {
      throw failure();
    }
    this.transport = new RunnerHttpTransport(options.http);
  }

  static async open(
    options: RunnerEvidenceCollectorOptions,
  ): Promise<RunnerEvidenceCollector> {
    try {
      const collector = new RunnerEvidenceCollector({ ...options });
      const ids = options.spool.ids();
      if (ids.length > MAX_RECORDS || new Set(ids).size !== ids.length) {
        throw failure();
      }
      for (const id of ids) {
        if (!/^[a-f0-9]{64}$/.test(id)) {
          throw failure();
        }
        await collector.read(id);
        collector.pending.add(id);
      }
      return collector;
    } catch {
      throw failure();
    }
  }

  /** Pending/ambiguous evidence prevents further spend, including across assignments. */
  get readyForWork(): boolean {
    return (
      !this.poisoned &&
      !this.flushing &&
      this.active.size === 0 &&
      this.pending.size === 0
    );
  }

  owns(runnerId: string, ownerSubject: string): boolean {
    return (
      runnerId === this.options.runnerId &&
      ownerSubject === this.options.ownerSubject
    );
  }

  /** Caller abort applies to delivery only: preserve even a late receipt after shutdown. */
  async report(
    input: LateEvidence,
    signal?: AbortSignal,
  ): Promise<EvidenceReceipt> {
    let id: string | undefined;
    try {
      const message = this.validate(input);
      id = this.id(message);
      if (
        this.poisoned ||
        this.flushing ||
        this.active.size >= 8 ||
        this.active.has(id)
      ) {
        throw failure();
      }
      this.active.add(id);
    } catch {
      throw failure();
    }
    try {
      // Re-parse a private snapshot before the first await; callers cannot alter a retained event.
      const message = this.validate(input);
      if (this.pending.has(id)) {
        if (JSON.stringify(await this.read(id)) !== JSON.stringify(message)) {
          throw failure();
        }
      } else {
        const plaintext = Buffer.from(JSON.stringify(message));
        try {
          if (plaintext.length > MAX_RECORD_BYTES) {
            throw failure();
          }
          const ciphertext = await this.options.cipher.seal(
            plaintext,
            this.context(id),
          );
          try {
            if (ciphertext.length < 1 || ciphertext.length > MAX_RECORD_BYTES) {
              throw failure();
            }
            if (this.pending.size >= MAX_RECORDS) {
              throw failure();
            }
            this.options.spool.put(id, ciphertext);
            this.pending.add(id);
          } finally {
            ciphertext.fill(0);
          }
        } finally {
          plaintext.fill(0);
        }
      }
      return await this.deliver(id, message, signal);
    } catch {
      // A capacity/write/encryption failure may have left an ambiguous local append.
      // Never infer a safe zero backlog from memory after such a failure.
      if (!this.pending.has(id)) {
        this.poisoned = true;
      }
      throw failure();
    } finally {
      this.active.delete(id);
    }
  }

  /** Explicit bounded, sequential replay. Stop at first failure; no timer or hidden retry. */
  async flush(signal?: AbortSignal): Promise<number> {
    if (this.poisoned || this.flushing || this.active.size !== 0) {
      throw failure();
    }
    this.flushing = true;
    let delivered = 0;
    try {
      for (const id of [...this.pending]) {
        if (signal?.aborted) {
          throw failure();
        }
        await this.deliver(id, await this.read(id), signal);
        delivered++;
      }
      return delivered;
    } catch {
      throw failure();
    } finally {
      this.flushing = false;
    }
  }

  private validate(input: LateEvidence): LateEvidence {
    const value = LateEvidence.parse(input);
    if (
      value.token.runnerId !== this.options.runnerId ||
      value.token.executionId !== value.evidence.executionId ||
      value.token.attemptId !== value.evidence.attemptId
    ) {
      throw failure();
    }
    return value;
  }

  private id(value: LateEvidence): string {
    return hash(
      JSON.stringify([
        value.token,
        value.evidence.sourceEventId,
        value.evidence.sourceRevision,
      ]),
    );
  }

  private context(id: string): string {
    return JSON.stringify([
      'runner-evidence-v1',
      this.options.runnerId,
      this.options.ownerSubject,
      id,
    ]);
  }

  private async read(id: string): Promise<LateEvidence> {
    const ciphertext = this.options.spool.read(id);
    let plaintext: Uint8Array | undefined;
    try {
      if (ciphertext.length < 1 || ciphertext.length > MAX_RECORD_BYTES) {
        throw failure();
      }
      plaintext = await this.options.cipher.open(ciphertext, this.context(id));
      if (plaintext.length < 1 || plaintext.length > MAX_RECORD_BYTES) {
        throw failure();
      }
      const message = this.validate(
        JSON.parse(
          new TextDecoder('utf-8', { fatal: true }).decode(plaintext),
        ) as LateEvidence,
      );
      if (this.id(message) !== id) {
        throw failure();
      }
      return message;
    } finally {
      plaintext?.fill(0);
      ciphertext.fill(0);
    }
  }

  private async deliver(
    id: string,
    message: LateEvidence,
    signal?: AbortSignal,
  ): Promise<EvidenceReceipt> {
    const value = await this.transport.post(
      apiContract.runner.evidence.path,
      message,
      signal,
      202,
    );
    const receipt = EvidenceReceipt.parse(value);
    try {
      this.options.spool.remove(id);
      this.pending.delete(id);
    } catch {
      this.poisoned = true;
      throw failure();
    }
    return receipt;
  }
}
