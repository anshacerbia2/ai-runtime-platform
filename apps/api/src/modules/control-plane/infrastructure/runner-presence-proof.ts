import { createHash } from 'node:crypto';
import type {
  RunnerPresenceProof,
  RunnerPresenceStore,
} from '../application/runner-presence-store.port.js';
import type { RunnerRegistrationIdentity } from '../application/runner-liveness-registry.port.js';

const RESOURCE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$/;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertRegistration(registration: RunnerRegistrationIdentity) {
  if (!RESOURCE_ID.test(registration.runnerId)) {
    throw new Error('Runner presence ID must be a resource identifier.');
  }
  if (!registration.ownerSubject || registration.ownerSubject.length > 512) {
    throw new Error('Runner presence owner subject is invalid.');
  }
  if (
    !Number.isSafeInteger(registration.registrationRevision) ||
    registration.registrationRevision < 1 ||
    registration.registrationRevision > 2_147_483_646
  ) {
    throw new Error('Runner registration revision is invalid.');
  }
}

export function runnerPresenceKey(
  prefix: string,
  registration: RunnerRegistrationIdentity,
) {
  assertRegistration(registration);
  const runnerDigest = createHash('sha256')
    .update(registration.runnerId)
    .digest('hex');
  return `${prefix}:${runnerDigest}`;
}

export function runnerPresenceIdentity(
  registration: RunnerRegistrationIdentity,
) {
  assertRegistration(registration);
  return createHash('sha256')
    .update(
      JSON.stringify([
        '1',
        registration.runnerId,
        registration.ownerSubject,
        registration.registrationRevision,
      ]),
    )
    .digest('hex');
}

export function encodeRunnerPresence(proof: RunnerPresenceProof) {
  if (!UUID.test(proof.bootId)) {
    throw new Error('Runner boot ID must be a UUID.');
  }
  return `${runnerPresenceIdentity(proof)}:${proof.bootId}`;
}

export function assertRunnerPresenceTtl(ttlMs: number) {
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 10_000 || ttlMs > 60_000) {
    throw new Error(
      'Runner presence TTL must be an integer between 10000 and 60000 milliseconds.',
    );
  }
}

export class UnavailableRunnerPresenceStore implements RunnerPresenceStore {
  async heartbeat(): Promise<void> {
    throw new Error('Runner coordination Redis is not configured.');
  }

  async inspect(): Promise<never> {
    throw new Error('Runner coordination Redis is not configured.');
  }
}
