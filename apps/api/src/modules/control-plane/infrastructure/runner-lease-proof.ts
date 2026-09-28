import { createHash } from 'node:crypto';
import type { RunnerLeaseProof } from '../application/runner-lease-store.port.js';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NONCE = /^[A-Za-z0-9_-]{32,128}$/;
export const MIN_RUNNER_LEASE_TTL_MS = 5_000;
export const MAX_RUNNER_LEASE_TTL_MS = 60_000;

export function runnerLeaseKey(prefix: string, proof: RunnerLeaseProof) {
  if (!UUID.test(proof.executionId)) {
    throw new Error('Runner lease execution ID must be a UUID.');
  }
  return `${prefix}:${proof.executionId}`;
}

export function encodeRunnerLeaseProof(proof: RunnerLeaseProof) {
  const identifiers: ReadonlyArray<readonly [string, string]> = [
    ['assignment', proof.assignmentId],
    ['execution', proof.executionId],
    ['attempt', proof.attemptId],
    ['runner', proof.runnerId],
  ];
  for (const [label, value] of identifiers) {
    if (!UUID.test(value)) {
      throw new Error(`Runner lease ${label} ID must be a UUID.`);
    }
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
