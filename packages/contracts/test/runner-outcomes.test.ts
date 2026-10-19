import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import {
  apiContract,
  RunnerStopReport,
  RunnerResultReconciliation,
  RunnerStopReceipt,
} from '../src/http/index.js';

const binding = () => ({
  token: {
    assignmentId: randomUUID(),
    executionId: randomUUID(),
    attemptId: randomUUID(),
    runnerId: 'runner-one',
    generation: 1,
    epoch: 1,
  },
  bootId: randomUUID(),
  registrationRevision: 1,
});

test('stop intake has exact old-process identity and strict termination evidence without a lease nonce', () => {
  const report = {
    ...binding(),
    evidence: { state: 'UNCONFIRMED', method: null },
  };
  assert.deepEqual(RunnerStopReport.parse(report), report);
  assert.equal(
    RunnerStopReport.safeParse({
      ...report,
      evidence: { state: 'TERMINATED', method: null },
    }).success,
    false,
  );
  assert.equal(
    RunnerStopReport.safeParse({
      ...report,
      evidence: { state: 'UNCONFIRMED', method: 'FORCED' },
    }).success,
    false,
  );
  assert.equal(
    RunnerStopReport.safeParse({ ...report, nonce: 'a'.repeat(32) }).success,
    false,
  );
  assert.equal(
    RunnerStopReport.safeParse({ ...report, registrationRevision: 0 }).success,
    false,
  );
});

test('stop receipt is quarantined and result reconciliation cannot claim execution completion', () => {
  const scope = binding();
  const receipt = {
    id: randomUUID(),
    binding: scope,
    evidence: { state: 'TERMINATED', method: 'OBSERVED' },
    state: 'QUARANTINED',
    replayed: false,
    stale: true,
  };
  assert.equal(RunnerStopReceipt.safeParse(receipt).success, true);
  assert.equal(
    RunnerStopReceipt.safeParse({ ...receipt, state: 'VERIFIED' }).success,
    false,
  );
  for (const state of ['MATCHED', 'NOT_RECORDED', 'CONFLICT']) {
    assert.equal(
      RunnerResultReconciliation.safeParse({
        binding: scope,
        proposalDigest: 'a'.repeat(64),
        state,
        stale: true,
      }).success,
      true,
    );
  }
  assert.equal(
    RunnerResultReconciliation.safeParse({
      binding: scope,
      proposalDigest: 'a'.repeat(64),
      state: 'COMPLETED',
      stale: false,
    }).success,
    false,
  );
  assert.equal(apiContract.runner.stop.responses[202], RunnerStopReceipt);
  assert.equal(
    apiContract.runner.reconcileResult.responses[200],
    RunnerResultReconciliation,
  );
});
