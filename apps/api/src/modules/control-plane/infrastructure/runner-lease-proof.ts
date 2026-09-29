import { createHash } from 'node:crypto';
import type {
  RunnerLeaseDurableProof,
  RunnerLeaseMatchResult,
  RunnerLeaseProof,
} from '../application/runner-lease-store.port.js';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RESOURCE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$/;
const NONCE = /^[A-Za-z0-9_-]{32,128}$/;
export const MIN_RUNNER_LEASE_TTL_MS = 5_000;
export const MAX_RUNNER_LEASE_TTL_MS = 60_000;

export function runnerLeaseKey(
  prefix: string,
  proof: Pick<RunnerLeaseProof, 'executionId'>,
) {
  if (!UUID.test(proof.executionId)) {
    throw new Error('Runner lease execution ID must be a UUID.');
  }
  return `${prefix}:${proof.executionId}`;
}

export function matchDurableRunnerLease(
  encoded: string | null,
  proof: RunnerLeaseDurableProof,
): RunnerLeaseMatchResult {
  if (encoded === null) {
    return 'MISSING';
  }
  if (encoded.length > 2_048 || !/^[a-f0-9]{64}$/.test(proof.nonceDigest)) {
    return 'MISMATCH';
  }
  let fields: unknown;
  try {
    fields = JSON.parse(encoded);
  } catch {
    return 'MISMATCH';
  }
  if (
    !Array.isArray(fields) ||
    fields.length !== 9 ||
    typeof fields[8] !== 'string' ||
    !NONCE.test(fields[8])
  ) {
    return 'MISMATCH';
  }
  const ownerDigest = createHash('sha256')
    .update(proof.ownerSubject)
    .digest('hex');
  const nonceDigest = createHash('sha256').update(fields[8]).digest('hex');
  return fields[0] === '1' &&
    fields[1] === proof.assignmentId &&
    fields[2] === proof.executionId &&
    fields[3] === proof.attemptId &&
    fields[4] === proof.runnerId &&
    fields[5] === ownerDigest &&
    fields[6] === proof.generation &&
    fields[7] === proof.epoch &&
    nonceDigest === proof.nonceDigest
    ? 'CURRENT'
    : 'MISMATCH';
}

export function encodeRunnerLeaseProof(proof: RunnerLeaseProof) {
  const identifiers: ReadonlyArray<readonly [string, string]> = [
    ['assignment', proof.assignmentId],
    ['execution', proof.executionId],
    ['attempt', proof.attemptId],
  ];
  for (const [label, value] of identifiers) {
    if (!UUID.test(value)) {
      throw new Error(`Runner lease ${label} ID must be a UUID.`);
    }
  }
  if (!RESOURCE_ID.test(proof.runnerId)) {
    throw new Error('Runner lease runner ID must be a resource identifier.');
  }
  if (!proof.ownerSubject || proof.ownerSubject.length > 512) {
    throw new Error('Runner lease owner subject is invalid.');
  }
  if (
    !Number.isSafeInteger(proof.generation) ||
    proof.generation < 1 ||
    !Number.isSafeInteger(proof.epoch) ||
    proof.epoch < 1
  ) {
    throw new Error(
      'Runner lease generation and epoch must be positive integers.',
    );
  }
  if (!NONCE.test(proof.nonce)) {
    throw new Error('Runner lease nonce must be 32-128 base64url characters.');
  }
  const ownerDigest = createHash('sha256')
    .update(proof.ownerSubject)
    .digest('hex');
  return JSON.stringify([
    '1',
    proof.assignmentId,
    proof.executionId,
    proof.attemptId,
    proof.runnerId,
    ownerDigest,
    proof.generation,
    proof.epoch,
    proof.nonce,
  ]);
}

export function assertRunnerLeaseTtl(ttlMs: number) {
  if (
    !Number.isSafeInteger(ttlMs) ||
    ttlMs < MIN_RUNNER_LEASE_TTL_MS ||
    ttlMs > MAX_RUNNER_LEASE_TTL_MS
  ) {
    throw new Error(
      `Runner lease TTL must be an integer between ${MIN_RUNNER_LEASE_TTL_MS} and ${MAX_RUNNER_LEASE_TTL_MS} milliseconds.`,
    );
  }
}
