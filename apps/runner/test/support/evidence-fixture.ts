import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
} from 'node:crypto';
import type { LateEvidence } from '@ai-runtime/contracts/http';
import type { EvidenceCipher } from '../../src/runner-evidence-collector.js';

/** Ephemeral test key only; not a production key provider. */
export function fixtureCipher(key: Uint8Array): EvidenceCipher {
  return {
    async seal(plaintext, context) {
      const nonce = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, nonce);
      cipher.setAAD(Buffer.from(context));
      const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      return Buffer.concat([nonce, cipher.getAuthTag(), body]);
    },
    async open(ciphertext, context) {
      const bytes = Buffer.from(ciphertext);
      const decipher = createDecipheriv(
        'aes-256-gcm',
        key,
        bytes.subarray(0, 12),
      );
      decipher.setAAD(Buffer.from(context));
      decipher.setAuthTag(bytes.subarray(12, 28));
      return Buffer.concat([
        decipher.update(bytes.subarray(28)),
        decipher.final(),
      ]);
    },
  };
}

export function fixtureEvidence(): LateEvidence {
  const executionId = randomUUID();
  const attemptId = randomUUID();
  return {
    token: {
      assignmentId: randomUUID(),
      executionId,
      attemptId,
      runnerId: 'runner-one',
      generation: 1,
      epoch: 1,
    },
    evidence: {
      executionId,
      attemptId,
      sourceEventId: 'provider-call',
      sourceRevision: 1,
      coverage: ['provider-call'],
      cumulativeUnits: null,
      completeness: 'unknown',
      costBasis: 'unknown',
      reason: 'sensitive fixture usage reason',
    },
  };
}
