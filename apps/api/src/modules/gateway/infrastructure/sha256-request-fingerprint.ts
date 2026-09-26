import { createHash } from 'node:crypto';
import { canonicalJson } from '@ai-runtime/contracts';
import type { RequestFingerprint } from '../application/request-fingerprint.port.js';

export class Sha256RequestFingerprint implements RequestFingerprint {
  digest(value: unknown) {
    return createHash('sha256').update(canonicalJson(value)).digest('hex');
  }
}
