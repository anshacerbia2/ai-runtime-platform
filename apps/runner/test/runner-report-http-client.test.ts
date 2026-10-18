import type { UsageCommand } from '@ai-runtime/contracts';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import type { RunnerLeaseCommand } from '@ai-runtime/contracts/http';
import {
  RunnerReportHttpClient,
  type RunnerResultProposal,
} from '../src/runner-report-http-client.js';
import {
  RunnerHttpError,
  type RunnerHttpOptions,
} from '../src/runner-http-transport.js';

function fixture() {
  const command: RunnerLeaseCommand = {
    bootId: randomUUID(),
    registrationRevision: 3,
    nonce: 'a'.repeat(32),
    token: {
      assignmentId: randomUUID(),
      executionId: randomUUID(),
      attemptId: randomUUID(),
      runnerId: 'runner-one',
      generation: 1,
      epoch: 2,
    },
  };
  const proposal: RunnerResultProposal = {
    outcome: 'completed',
    digest: 'a'.repeat(64),
    artifactIds: [],
    summary: 'fixture result',
  };
  const evidence: UsageCommand = {
    executionId: command.token.executionId,
    attemptId: command.token.attemptId,
    sourceEventId: 'provider-call-one',
    sourceRevision: 1,
    coverage: ['provider-call-one'],
    cumulativeUnits: null,
    completeness: 'unknown',
    costBasis: 'unknown',
    reason: 'provider outcome unknown',
  };
  return { command, proposal, evidence };
}
const http = (fetchImpl: typeof fetch): RunnerHttpOptions => ({
  origin: 'https://runner-api.example',
  timeoutMs: 100,
  bearerToken: async () => 'fixture-token',
  fetchImpl,
});
const invalid = (error: unknown) =>
  error instanceof RunnerHttpError && error.kind === 'INVALID';

test('result proposal captures exact boot/lease scope and requires RESULT_PROPOSED acknowledgement', async () => {
  const f = fixture();
  const captured = structuredClone(f.command);
  let calls = 0;
  const client = new RunnerReportHttpClient(
    f.command,
    'owner-one',
    http(async (input, init) => {
      calls++;
      assert.equal(new URL(String(input)).pathname, '/api/runner/v1/reports');
      assert.deepEqual(JSON.parse(String(init?.body)), {
        type: 'result.proposed',
        token: captured.token,
        lease: {
          bootId: captured.bootId,
          registrationRevision: 3,
          nonce: captured.nonce,
        },
        proposal: f.proposal,
      });
      return Response.json({
        ...captured.token,
        ownerSubject: 'owner-one',
        protocolVersion: '1',
        state: 'RESULT_PROPOSED',
      });
    }),
  );
  f.command.token.epoch++;
  f.command.nonce = 'b'.repeat(32);
  await client.propose(f.proposal);
  assert.equal(calls, 1);
});

test('result acknowledgement cannot change owner/state or any assignment token field', async () => {
  const f = fixture();
  for (const patch of [
    { ownerSubject: 'other' },
    { state: 'STARTED' },
    { generation: 2 },
    { epoch: 3 },
    { assignmentId: randomUUID() },
    { executionId: randomUUID() },
    { attemptId: randomUUID() },
    { runnerId: 'other' },
  ]) {
    const client = new RunnerReportHttpClient(
      f.command,
      'owner-one',
      http(async () =>
        Response.json({
          ...f.command.token,
          ownerSubject: 'owner-one',
          protocolVersion: '1',
          state: 'RESULT_PROPOSED',
          ...patch,
        }),
      ),
    );
    await assert.rejects(client.propose(f.proposal), invalid);
  }
});

test('quarantined evidence uses exact old token with no lease and accepts only HTTP 202', async () => {
  const f = fixture();
  const id = randomUUID();
  let calls = 0;
  const client = new RunnerReportHttpClient(
    f.command,
    'owner-one',
    http(async (input, init) => {
      calls++;
      assert.equal(new URL(String(input)).pathname, '/api/runner/v1/evidence');
      assert.deepEqual(JSON.parse(String(init?.body)), {
        token: f.command.token,
        evidence: f.evidence,
      });
      return Response.json(
        { id, state: 'QUARANTINED', replayed: false, stale: true },
        { status: 202 },
      );
    }),
  );
  assert.deepEqual(await client.evidence(f.evidence), {
    id,
    state: 'QUARANTINED',
    replayed: false,
    stale: true,
  });
  assert.equal(calls, 1);
  for (const status of [200, 201]) {
    const wrong = new RunnerReportHttpClient(
      f.command,
      'owner-one',
      http(async () =>
        Response.json(
          { id, state: 'QUARANTINED', replayed: false, stale: true },
          { status },
        ),
      ),
    );
    await assert.rejects(wrong.evidence(f.evidence), RunnerHttpError);
  }
});

test('evidence and result shape/scope failures send no HTTP or upstream diagnostics', async () => {
  const f = fixture();
  let calls = 0;
  const client = new RunnerReportHttpClient(
    f.command,
    'owner-one',
    http(async () => {
      calls++;
      throw new Error('private diagnostics');
    }),
  );
  await assert.rejects(
    client.evidence({ ...f.evidence, executionId: randomUUID() }),
    invalid,
  );
  await assert.rejects(
    client.evidence({ ...f.evidence, attemptId: randomUUID() }),
    invalid,
  );
  await assert.rejects(
    client.evidence({ ...f.evidence, cumulativeUnits: '0' }),
    invalid,
  );
  await assert.rejects(
    client.propose({ ...f.proposal, digest: 'private diagnostics' }),
    invalid,
  );
  assert.equal(calls, 0);
});

test('ambiguous result/evidence errors are bounded and never automatically retried', async () => {
  const f = fixture();
  let calls = 0;
  const client = new RunnerReportHttpClient(
    f.command,
    'owner-one',
    http(async () => {
      calls++;
      throw new Error('private diagnostics');
    }),
  );
  await assert.rejects(
    client.propose(f.proposal),
    (error: unknown) =>
      error instanceof RunnerHttpError &&
      !String(error).includes('private diagnostics'),
  );
  await assert.rejects(client.evidence(f.evidence), RunnerHttpError);
  assert.equal(calls, 2);
});

test('evidence rejects a verified/settled or malformed receipt instead of treating intake as settlement', async () => {
  const f = fixture();
  for (const receipt of [
    { id: randomUUID(), state: 'VERIFIED', replayed: false, stale: false },
    { state: 'QUARANTINED', replayed: false, stale: false },
  ]) {
    const client = new RunnerReportHttpClient(
      f.command,
      'owner-one',
      http(async () => Response.json(receipt, { status: 202 })),
    );
    await assert.rejects(client.evidence(f.evidence), invalid);
  }
});
