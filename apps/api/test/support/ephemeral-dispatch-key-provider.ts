import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type {
  DispatchDataKey,
  DispatchEnvelopeContext,
  DispatchKeyProvider,
} from '../../src/modules/dispatch-envelope/application/dispatch-envelope.ports.js';

function aad(context: DispatchEnvelopeContext) {
  return Buffer.from(
    [
      'dispatch-key-wrap/v1',
      context.envelopeId,
      context.applicationId,
      context.executionBindingId,
      context.profileRevisionId,
      context.inputDigest,
    ].join('\n'),
    'utf8',
  );
}

/** Test-only key provider. Production must supply KMS/HSM-backed GenerateDataKey. */
export class EphemeralDispatchKeyProvider implements DispatchKeyProvider {
  readonly provider = 'ephemeral-test-only';
  private readonly wrappingKey: Buffer;

  constructor(masterKey: Uint8Array = randomBytes(32)) {
    if (masterKey.byteLength !== 32) {
      throw new Error('Ephemeral wrapping key must contain exactly 32 bytes.');
    }
    this.wrappingKey = Buffer.from(masterKey);
  }

  async generateDataKey(
    context: DispatchEnvelopeContext,
  ): Promise<DispatchDataKey> {
    const plaintextKey = randomBytes(32);
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.wrappingKey, nonce);
    cipher.setAAD(aad(context));
    const encrypted = Buffer.concat([
      cipher.update(plaintextKey),
      cipher.final(),
    ]);
    return {
      plaintextKey,
      wrappedKey: Buffer.concat([nonce, cipher.getAuthTag(), encrypted]),
      provider: this.provider,
      keyReference: 'memory://dispatch-test-key/v1',
    };
  }

  async unwrapDataKey(
    context: DispatchEnvelopeContext,
    wrappedKey: Uint8Array,
    keyReference: string,
  ): Promise<Uint8Array> {
    if (
      keyReference !== 'memory://dispatch-test-key/v1' ||
      wrappedKey.byteLength !== 60
    ) {
      throw new Error('Ephemeral wrapped key is invalid.');
    }
    const nonce = wrappedKey.slice(0, 12);
    const tag = wrappedKey.slice(12, 28);
    const ciphertext = wrappedKey.slice(28);
    const decipher = createDecipheriv('aes-256-gcm', this.wrappingKey, nonce);
    decipher.setAAD(aad(context));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }
}
