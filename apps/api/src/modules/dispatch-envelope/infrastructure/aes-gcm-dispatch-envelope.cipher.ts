import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';
import type {
  DispatchEnvelopeCipher,
  DispatchEnvelopeContext,
  DispatchKeyProvider,
  SealedDispatchEnvelope,
} from '../application/dispatch-envelope.ports.js';
import { DispatchEnvelopeError } from '../application/dispatch-envelope.service.js';

const ALGORITHM = 'aes-256-gcm';

function digest(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex');
}

function additionalAuthenticatedData(context: DispatchEnvelopeContext) {
  return Buffer.from(
    [
      'dispatch-envelope/v1',
      context.envelopeId,
      context.applicationId,
      context.executionBindingId,
      context.profileRevisionId,
      context.inputDigest,
    ].join('\n'),
    'utf8',
  );
}

function assertDataKey(key: Uint8Array) {
  if (key.byteLength !== 32) {
    throw new Error('Dispatch data key must contain exactly 32 bytes.');
  }
}

export class AesGcmDispatchEnvelopeCipher implements DispatchEnvelopeCipher {
  constructor(private readonly keyProvider: DispatchKeyProvider) {}

  async seal(
    context: DispatchEnvelopeContext,
    plaintext: Uint8Array,
  ): Promise<SealedDispatchEnvelope> {
    const dataKey = await this.keyProvider.generateDataKey(context);
    assertDataKey(dataKey.plaintextKey);
    if (dataKey.provider !== this.keyProvider.provider) {
      dataKey.plaintextKey.fill(0);
      throw new Error('Dispatch key provider returned an invalid identity.');
    }
    const nonce = randomBytes(12);
    try {
      const cipher = createCipheriv(ALGORITHM, dataKey.plaintextKey, nonce);
      cipher.setAAD(additionalAuthenticatedData(context));
      const ciphertext = Buffer.concat([
        cipher.update(plaintext),
        cipher.final(),
      ]);
      const authenticationTag = cipher.getAuthTag();
      return {
        ciphertext,
        plaintextSha256: digest(plaintext),
        ciphertextSha256: digest(ciphertext),
        plaintextBytes: plaintext.byteLength,
        ciphertextBytes: ciphertext.byteLength,
        encryptionAlgorithm: 'AES-256-GCM',
        keyProvider: dataKey.provider,
        keyReference: dataKey.keyReference,
        wrappedDataKey: dataKey.wrappedKey,
        nonce,
        authenticationTag,
      };
    } finally {
      dataKey.plaintextKey.fill(0);
    }
  }

  async open(
    context: DispatchEnvelopeContext,
    envelope: Omit<SealedDispatchEnvelope, 'ciphertext'>,
    ciphertext: Uint8Array,
  ): Promise<Uint8Array> {
    if (
      envelope.encryptionAlgorithm !== 'AES-256-GCM' ||
      envelope.keyProvider !== this.keyProvider.provider ||
      digest(ciphertext) !== envelope.ciphertextSha256 ||
      ciphertext.byteLength !== envelope.ciphertextBytes
    ) {
      throw new DispatchEnvelopeError(
        'ENVELOPE_CORRUPT',
        'Dispatch ciphertext metadata does not match the stored object.',
      );
    }
    let dataKey: Uint8Array | undefined;
    try {
      dataKey = await this.keyProvider.unwrapDataKey(
        context,
        envelope.wrappedDataKey,
        envelope.keyReference,
      );
      assertDataKey(dataKey);
      const decipher = createDecipheriv(ALGORITHM, dataKey, envelope.nonce);
      decipher.setAAD(additionalAuthenticatedData(context));
      decipher.setAuthTag(envelope.authenticationTag);
      const plaintext = Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]);
      if (
        digest(plaintext) !== envelope.plaintextSha256 ||
        plaintext.byteLength !== envelope.plaintextBytes
      ) {
        throw new DispatchEnvelopeError(
          'ENVELOPE_CORRUPT',
          'Dispatch plaintext integrity verification failed.',
        );
      }
      return plaintext;
    } catch (error) {
      if (error instanceof DispatchEnvelopeError) {
        throw error;
      }
      throw new DispatchEnvelopeError(
        'ENVELOPE_CORRUPT',
        'Dispatch envelope authentication failed.',
      );
    } finally {
      dataKey?.fill(0);
    }
  }
}
