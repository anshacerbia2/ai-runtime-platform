export const DISPATCH_ENVELOPE_MAX_PLAINTEXT_BYTES = 1_048_576;
export const DISPATCH_ENVELOPE_MAX_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;
export const DISPATCH_ENVELOPE_OBJECT_PREFIX = 'dispatch-envelopes/v1/';

export type DispatchEnvelopeState =
  'STAGED' | 'COMMITTED' | 'CONSUMED' | 'DELETE_PENDING' | 'EXPIRED';

export interface DispatchEnvelopeContext {
  envelopeId: string;
  applicationId: string;
  executionBindingId: string;
  profileRevisionId: string;
  inputDigest: string;
}

export interface DispatchDataKey {
  plaintextKey: Uint8Array;
  wrappedKey: Uint8Array;
  provider: string;
  keyReference: string;
}

export interface DispatchKeyProvider {
  readonly provider: string;
  generateDataKey(context: DispatchEnvelopeContext): Promise<DispatchDataKey>;
  unwrapDataKey(
    context: DispatchEnvelopeContext,
    wrappedKey: Uint8Array,
    keyReference: string,
  ): Promise<Uint8Array>;
}

export interface SealedDispatchEnvelope {
  ciphertext: Uint8Array;
  plaintextSha256: string;
  ciphertextSha256: string;
  plaintextBytes: number;
  ciphertextBytes: number;
  encryptionAlgorithm: 'AES-256-GCM';
  keyProvider: string;
  keyReference: string;
  wrappedDataKey: Uint8Array;
  nonce: Uint8Array;
  authenticationTag: Uint8Array;
}

export interface StoredDispatchEnvelope
  extends DispatchEnvelopeContext, Omit<SealedDispatchEnvelope, 'ciphertext'> {
  objectKey: string;
  state: DispatchEnvelopeState;
  revision: number;
  executionId: string | null;
  createdAt: Date;
  committedAt: Date | null;
  consumedAt: Date | null;
  expiresAt: Date;
  deleteClaimedAt: Date | null;
  expiredAt: Date | null;
}

export interface DispatchEnvelopeCipher {
  seal(
    context: DispatchEnvelopeContext,
    plaintext: Uint8Array,
  ): Promise<SealedDispatchEnvelope>;
  open(
    context: DispatchEnvelopeContext,
    envelope: Omit<SealedDispatchEnvelope, 'ciphertext'>,
    ciphertext: Uint8Array,
  ): Promise<Uint8Array>;
}

export interface DispatchObject {
  key: string;
  lastModified: Date;
}

export interface DispatchEnvelopeBlobStore {
  putIfAbsent(
    key: string,
    ciphertext: Uint8Array,
    ciphertextSha256: string,
  ): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  delete(key: string): Promise<void>;
  list(prefix: string, limit: number): Promise<DispatchObject[]>;
}

export interface StageDispatchEnvelopeRecord
  extends DispatchEnvelopeContext, Omit<SealedDispatchEnvelope, 'ciphertext'> {
  objectKey: string;
  retentionMs: number;
}

export interface DispatchEnvelopeRepository {
  createStaged(
    record: StageDispatchEnvelopeRecord,
  ): Promise<StoredDispatchEnvelope>;
  find(id: string): Promise<StoredDispatchEnvelope | null>;
  findCommitted(
    id: string,
    applicationId: string,
  ): Promise<StoredDispatchEnvelope | null>;
  consume(
    id: string,
    applicationId: string,
    expectedRevision: number,
  ): Promise<StoredDispatchEnvelope>;
  claimExpired(limit: number): Promise<StoredDispatchEnvelope[]>;
  markExpired(id: string, expectedRevision: number): Promise<boolean>;
  existingObjectKeys(keys: string[]): Promise<Set<string>>;
}

export interface DispatchPayloadAuthorization {
  assertCurrent(
    principal: Principal,
    command: RunnerLeaseCommand,
    envelopeId: string,
  ): Promise<{ applicationId: string }>;
}
import type { RunnerLeaseCommand } from '@ai-runtime/contracts/http';
import type { Principal } from '../../identity/domain/principal.js';
