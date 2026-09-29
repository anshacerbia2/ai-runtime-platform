import type {
  DispatchEnvelopeBlobStore,
  DispatchEnvelopeCipher,
  DispatchEnvelopeContext,
  DispatchEnvelopeRepository,
  StoredDispatchEnvelope,
} from './dispatch-envelope.ports.js';
import {
  DISPATCH_ENVELOPE_MAX_PLAINTEXT_BYTES,
  DISPATCH_ENVELOPE_MAX_RETENTION_MS,
  DISPATCH_ENVELOPE_OBJECT_PREFIX,
} from './dispatch-envelope.ports.js';

const SHA256 = /^[0-9a-f]{64}$/;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class DispatchEnvelopeError extends Error {
  constructor(
    readonly code:
      | 'INVALID_ENVELOPE'
      | 'ENVELOPE_CONFLICT'
      | 'ENVELOPE_NOT_FOUND'
      | 'ENVELOPE_NOT_DISPATCHABLE'
      | 'ENVELOPE_CORRUPT',
    message: string,
  ) {
    super(message);
    this.name = 'DispatchEnvelopeError';
  }
}

export interface StageDispatchEnvelope {
  envelopeId: string;
  applicationId: string;
  executionBindingId: string;
  profileRevisionId: string;
  inputDigest: string;
  plaintext: Uint8Array;
  retentionMs: number;
}

function contextOf(
  envelope: Pick<
    StoredDispatchEnvelope,
    | 'envelopeId'
    | 'applicationId'
    | 'executionBindingId'
    | 'profileRevisionId'
    | 'inputDigest'
  >,
): DispatchEnvelopeContext {
  return envelope;
}

function requireStage(command: StageDispatchEnvelope) {
  if (
    !UUID.test(command.envelopeId) ||
    !UUID.test(command.executionBindingId) ||
    !UUID.test(command.profileRevisionId) ||
    !SHA256.test(command.inputDigest)
  ) {
    throw new DispatchEnvelopeError(
      'INVALID_ENVELOPE',
      'Envelope identifiers or input digest are invalid.',
    );
  }
  if (
    command.plaintext.byteLength === 0 ||
    command.plaintext.byteLength > DISPATCH_ENVELOPE_MAX_PLAINTEXT_BYTES
  ) {
    throw new DispatchEnvelopeError(
      'INVALID_ENVELOPE',
      'Dispatch plaintext size is outside the supported bound.',
    );
  }
  if (
    !Number.isSafeInteger(command.retentionMs) ||
    command.retentionMs < 1_000 ||
    command.retentionMs > DISPATCH_ENVELOPE_MAX_RETENTION_MS
  ) {
    throw new DispatchEnvelopeError(
      'INVALID_ENVELOPE',
      'Dispatch envelope retention must be between one second and seven days.',
    );
  }
}

/** Coordinates ciphertext storage; PostgreSQL metadata remains dispatch authority. */
export class DispatchEnvelopeService {
  constructor(
    private readonly repository: DispatchEnvelopeRepository,
    private readonly blobs: DispatchEnvelopeBlobStore,
    private readonly cipher: DispatchEnvelopeCipher,
  ) {}

  async stage(command: StageDispatchEnvelope): Promise<StoredDispatchEnvelope> {
    requireStage(command);
    const context = contextOf(command);
    const sealed = await this.cipher.seal(context, command.plaintext);
    const { ciphertext, ...metadata } = sealed;
    const objectKey = DISPATCH_ENVELOPE_OBJECT_PREFIX + command.envelopeId;

    // Deliberate cross-store order: a database row never points at an object
    // that was not acknowledged. A crash here leaves a bounded GC orphan.
    await this.blobs.putIfAbsent(
      objectKey,
      ciphertext,
      sealed.ciphertextSha256,
    );
    return this.repository.createStaged({
      ...context,
      ...metadata,
      objectKey,
      retentionMs: command.retentionMs,
    });
  }

  async readCommitted(
    envelopeId: string,
    applicationId: string,
  ): Promise<Uint8Array> {
    const envelope = await this.repository.findCommitted(
      envelopeId,
      applicationId,
    );
    if (!envelope || envelope.state !== 'COMMITTED') {
      throw new DispatchEnvelopeError(
        'ENVELOPE_NOT_FOUND',
        'Dispatch envelope was not found.',
      );
    }
    const ciphertext = await this.blobs.get(envelope.objectKey);
    if (!ciphertext) {
      throw new DispatchEnvelopeError(
        'ENVELOPE_CORRUPT',
        'Committed dispatch ciphertext is missing.',
      );
    }
    return this.cipher.open(contextOf(envelope), envelope, ciphertext);
  }

  async consume(
    envelopeId: string,
    applicationId: string,
    expectedRevision: number,
  ) {
    return this.repository.consume(envelopeId, applicationId, expectedRevision);
  }

  async reapExpired(limit = 64): Promise<number> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 256) {
      throw new DispatchEnvelopeError(
        'INVALID_ENVELOPE',
        'Expiry batch limit must be between 1 and 256.',
      );
    }
    const claimed = await this.repository.claimExpired(limit);
    let completed = 0;
    for (const envelope of claimed) {
      try {
        await this.blobs.delete(envelope.objectKey);
        if (
          await this.repository.markExpired(
            envelope.envelopeId,
            envelope.revision,
          )
        ) {
          completed += 1;
        }
      } catch {
        // DELETE_PENDING is durable and will be retried by a later sweep.
      }
    }
    return completed;
  }

  async reapOrphanObjects(olderThan: Date, limit = 256): Promise<number> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
      throw new DispatchEnvelopeError(
        'INVALID_ENVELOPE',
        'Orphan batch limit must be between 1 and 1000.',
      );
    }
    const objects = (
      await this.blobs.list(DISPATCH_ENVELOPE_OBJECT_PREFIX, limit)
    ).filter((object) => object.lastModified < olderThan);
    const existing = await this.repository.existingObjectKeys(
      objects.map((object) => object.key),
    );
    let deleted = 0;
    for (const object of objects) {
      if (!existing.has(object.key)) {
        await this.blobs.delete(object.key);
        deleted += 1;
      }
    }
    return deleted;
  }
}
