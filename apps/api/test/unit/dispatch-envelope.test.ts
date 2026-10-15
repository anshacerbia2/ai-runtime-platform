import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { AesGcmDispatchEnvelopeCipher } from '../../src/modules/dispatch-envelope/infrastructure/aes-gcm-dispatch-envelope.cipher.js';
import { DispatchEnvelopeError } from '../../src/modules/dispatch-envelope/application/dispatch-envelope.service.js';
import { DispatchEnvelopeService } from '../../src/modules/dispatch-envelope/application/dispatch-envelope.service.js';
import { DispatchPayloadDeliveryService } from '../../src/modules/dispatch-envelope/application/dispatch-payload-delivery.service.js';
import type {
  DispatchEnvelopeBlobStore,
  DispatchEnvelopeRepository,
  StageDispatchEnvelopeRecord,
  StoredDispatchEnvelope,
} from '../../src/modules/dispatch-envelope/application/dispatch-envelope.ports.js';
import { EphemeralDispatchKeyProvider } from '../support/ephemeral-dispatch-key-provider.js';

function context() {
  return {
    envelopeId: randomUUID(),
    applicationId: `app:${randomUUID()}`,
    executionBindingId: randomUUID(),
    profileRevisionId: randomUUID(),
    inputDigest: randomBytes(32).toString('hex'),
  };
}

test('dispatch cipher round-trips without exposing plaintext or a plaintext data key', async () => {
  const cipher = new AesGcmDispatchEnvelopeCipher(
    new EphemeralDispatchKeyProvider(),
  );
  const binding = context();
  const plaintext = Buffer.from(
    `SYNTHETIC_DISPATCH_SECRET_${randomUUID()}`,
    'utf8',
  );
  const sealed = await cipher.seal(binding, plaintext);
  const { ciphertext, ...metadata } = sealed;

  assert.equal(sealed.encryptionAlgorithm, 'AES-256-GCM');
  assert.equal(sealed.nonce.byteLength, 12);
  assert.equal(sealed.authenticationTag.byteLength, 16);
  assert.equal(sealed.wrappedDataKey.byteLength, 60);
  assert.equal(Buffer.from(ciphertext).includes(plaintext), false);
  assert.equal(
    Buffer.from(await cipher.open(binding, metadata, ciphertext)).equals(
      plaintext,
    ),
    true,
  );
});

test('dispatch cipher authenticates execution binding and ciphertext bytes', async () => {
  const cipher = new AesGcmDispatchEnvelopeCipher(
    new EphemeralDispatchKeyProvider(),
  );
  const binding = context();
  const sealed = await cipher.seal(binding, Buffer.from('bounded input'));
  const { ciphertext, ...metadata } = sealed;

  await assert.rejects(
    cipher.open(
      { ...binding, executionBindingId: randomUUID() },
      metadata,
      ciphertext,
    ),
    (error) =>
      error instanceof DispatchEnvelopeError &&
      error.code === 'ENVELOPE_CORRUPT',
  );

  const tampered = Uint8Array.from(ciphertext);
  tampered[0] = tampered[0]! ^ 1;
  await assert.rejects(
    cipher.open(binding, metadata, tampered),
    (error) =>
      error instanceof DispatchEnvelopeError &&
      error.code === 'ENVELOPE_CORRUPT',
  );
});

class MemoryBlobs implements DispatchEnvelopeBlobStore {
  readonly entries = new Map<
    string,
    { bytes: Uint8Array; lastModified: Date }
  >();

  constructor(private readonly now: () => Date) {}

  async putIfAbsent(key: string, ciphertext: Uint8Array) {
    if (this.entries.has(key)) {
      throw new Error('duplicate');
    }
    this.entries.set(key, {
      bytes: Uint8Array.from(ciphertext),
      lastModified: this.now(),
    });
  }

  async get(key: string) {
    return this.entries.get(key)?.bytes ?? null;
  }

  async delete(key: string) {
    this.entries.delete(key);
  }

  async list(prefix: string, limit: number) {
    return [...this.entries.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .slice(0, limit)
      .map(([key, value]) => ({ key, lastModified: value.lastModified }));
  }
}

class FailingMetadata implements DispatchEnvelopeRepository {
  async createStaged(
    _record: StageDispatchEnvelopeRecord,
  ): Promise<StoredDispatchEnvelope> {
    throw new Error('synthetic database outage');
  }

  async find(_id: string): Promise<StoredDispatchEnvelope | null> {
    return null;
  }

  async findCommitted(): Promise<StoredDispatchEnvelope | null> {
    return null;
  }

  async consume(): Promise<StoredDispatchEnvelope> {
    throw new Error('not used');
  }

  async claimExpired(): Promise<StoredDispatchEnvelope[]> {
    return [];
  }

  async markExpired(): Promise<boolean> {
    return false;
  }

  async existingObjectKeys() {
    return new Set<string>();
  }
}

test('object-first staging leaves a discoverable orphan when PostgreSQL is unavailable', async () => {
  const instant = new Date('2026-09-29T00:00:00.000Z');
  const blobs = new MemoryBlobs(() => instant);
  const service = new DispatchEnvelopeService(
    new FailingMetadata(),
    blobs,
    new AesGcmDispatchEnvelopeCipher(new EphemeralDispatchKeyProvider()),
  );
  const binding = context();
  await assert.rejects(
    service.stage({
      ...binding,
      plaintext: Buffer.from('encrypted before metadata'),
      retentionMs: 60_000,
    }),
    /synthetic database outage/,
  );
  assert.equal(blobs.entries.size, 1);
  assert.equal(
    await service.reapOrphanObjects(new Date(instant.getTime() + 1_000), 10),
    1,
  );
  assert.equal(blobs.entries.size, 0);
});

test('payload delivery clears decrypted bytes when the lease is lost during download', async () => {
  const bytes = Buffer.from('sensitive synthetic payload');
  let checks = 0;
  const delivery = new DispatchPayloadDeliveryService(
    {
      async assertCurrent() {
        checks += 1;
        if (checks === 2) {
          throw new Error('lease lost during decrypt');
        }
        return { applicationId: 'fixture-app' };
      },
    },
    {
      async readCommitted() {
        return bytes;
      },
    } as unknown as DispatchEnvelopeService,
  );
  const token = {
    assignmentId: randomUUID(),
    executionId: randomUUID(),
    attemptId: randomUUID(),
    runnerId: 'fixture-runner',
    generation: 1,
    epoch: 1,
  };
  await assert.rejects(
    delivery.read(
      {
        subject: 'runner-owner',
        kind: 'runner',
        roles: ['runtime-runner'],
        scopes: ['runner:report'],
      },
      {
        token,
        bootId: randomUUID(),
        registrationRevision: 1,
        nonce: randomBytes(32).toString('base64url'),
      },
      randomUUID(),
    ),
    /lease lost during decrypt/,
  );
  assert.equal(checks, 2);
  assert.ok(bytes.every((byte) => byte === 0));
});
