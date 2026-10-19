import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { RunnerOutcomeService } from '../../src/modules/control-plane/application/runner-outcome.service.js';
import type { Principal } from '../../src/modules/identity/domain/principal.js';

test('outcome operations require runner kind and report scope before repository access', async () => {
  let calls = 0;
  const service = new RunnerOutcomeService({
    async stop() {
      calls++;
      throw new Error('repository reached');
    },
    async reconcileResult() {
      calls++;
      throw new Error('repository reached');
    },
  });
  const binding = {
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
  };
  for (const principal of [
    { kind: 'application', scopes: ['runner:report'] },
    { kind: 'operator', scopes: ['runner:report'] },
    { kind: 'runner', scopes: ['runner:register'] },
  ] as const) {
    const p: Principal = { ...principal, subject: 'fixture', roles: [] };
    assert.throws(
      () =>
        service.stop(p, {
          ...binding,
          evidence: { state: 'UNCONFIRMED', method: null },
        }),
      /not authorized/,
    );
    assert.throws(
      () =>
        service.reconcileResult(p, {
          ...binding,
          proposalDigest: 'a'.repeat(64),
        }),
      /not authorized/,
    );
  }
  assert.equal(calls, 0);
  const runner: Principal = {
    kind: 'runner',
    subject: 'fixture',
    roles: [],
    scopes: ['runner:report'],
  };
  await assert.rejects(
    service.stop(runner, {
      ...binding,
      evidence: { state: 'UNCONFIRMED', method: null },
    }),
    /repository reached/,
  );
  assert.equal(calls, 1);
});
