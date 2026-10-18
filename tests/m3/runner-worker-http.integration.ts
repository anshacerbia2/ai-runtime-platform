import assert from 'node:assert/strict';
import test from 'node:test';
import {
  stopInstance,
  until,
  workerFixture,
} from './worker-coordinators.fixture.js';

test(
  'lost claim ACK and API A exit preserve one assignment/boot/nonce as worker continues on API B',
  { timeout: 45_000 },
  async (t) => {
    const h = await workerFixture(t, { dropClaimAck: true });
    await h.start();
    let paidCalls = 0;
    assert.equal(
      await h.context.runStep(async () => {
        paidCalls++;
        return 'first-receipt';
      }),
      'first-receipt',
    );
    const before = await h.readAssignment();
    assert.equal(before.state, 'STARTED');
    assert.ok(before.leaseNonceDigest);
    assert.equal(before.claimBootId, h.worker.identity.bootId);
    assert.equal(
      h.traffic.filter((r) => r.path.endsWith('/claim') && r.dropped).length,
      1,
    );
    h.switchToPeer();
    await stopInstance(h.instances[0]!);
    assert.equal(
      await h.context.runStep(async () => {
        paidCalls++;
        return 'second-receipt';
      }),
      'second-receipt',
    );
    const evidence = h.evidence();
    const receipt = await h.context.reportEvidence(evidence);
    assert.equal(receipt.state, 'QUARANTINED');
    assert.equal(receipt.stale, false);
    const replay = await h.context.reportEvidence(evidence);
    assert.equal(replay.id, receipt.id);
    assert.equal(replay.replayed, true);
    h.release.resolve();
    const proposed = await until(
      h.readAssignment,
      (row) => row.state === 'RESULT_PROPOSED',
      'result proposal',
    );
    await until(
      async () => h.stops,
      (count) => count === 1,
      'sandbox fixture cleanup',
    );
    assert.equal(proposed.leaseNonceDigest, before.leaseNonceDigest);
    assert.equal(proposed.claimBootId, before.claimBootId);
    assert.equal(proposed.generation, before.generation);
    assert.equal(h.executions, 1);
    assert.equal(h.launches, 1);
    assert.equal(paidCalls, 2);
    assert.equal(
      await h.db.runnerAssignment.count({
        where: { executionId: h.executionId },
      }),
      1,
    );
    assert.equal(
      await h.db.attempt.count({ where: { executionId: h.executionId } }),
      1,
    );
    assert.equal(
      await h.db.runnerEvidence.count({
        where: { executionId: h.executionId },
      }),
      1,
    );
    assert.equal(
      await h.db.outboxEvent.count({
        where: { aggregateId: proposed.id, topic: 'runner.result-proposed' },
      }),
      1,
    );
    assert.equal(
      (await h.db.execution.findUniqueOrThrow({ where: { id: h.executionId } }))
        .status,
      'RUNNING',
    );
    const reservation = await h.db.reservation.findFirstOrThrow({
      where: { executionId: h.executionId },
    });
    assert.equal(reservation.heldUnits, 10n);
    assert.equal(reservation.state, 'RESERVED');
    assert.equal(
      await h.db.ledgerEntry.count({ where: { executionId: h.executionId } }),
      0,
    );
    assert.equal(
      await h.db.usageObservation.count({
        where: { executionId: h.executionId },
      }),
      0,
    );
    assert.ok(
      h.traffic.some(
        (r) =>
          r.target === 0 && r.path.endsWith('/activate') && r.status === 200,
      ),
    );
    assert.ok(
      h.traffic.some(
        (r) =>
          r.target === 1 && r.path.endsWith('/activate') && r.status === 200,
      ),
    );
    assert.ok(
      h.traffic.some(
        (r) =>
          r.target === 1 && r.type === 'result.proposed' && r.status === 200,
      ),
    );
  },
);

test(
  'cancel committed through API B stops worker on API A and retains late unknown usage',
  { timeout: 45_000 },
  async (t) => {
    const h = await workerFixture(t);
    await h.start();
    let paidCalls = 0;
    let finish!: () => void;
    const remote = new Promise<string>((resolve) => {
      finish = () => resolve('already accepted remote receipt');
    });
    const inFlight = h.context.runStep(async () => {
      paidCalls++;
      return remote;
    });
    await until(
      async () => paidCalls,
      (count) => count === 1,
      'in-flight fixture provider call',
    );
    const cancelled = await h.cancel();
    assert.equal(cancelled.status, 201);
    await cancelled.arrayBuffer();
    assert.ok(
      (await h.db.execution.findUniqueOrThrow({ where: { id: h.executionId } }))
        .cancelRequestedAt,
    );
    await assert.rejects(
      h.context.runStep(async () => {
        paidCalls++;
      }),
    );
    assert.equal(h.context.signal.aborted, true);
    finish();
    assert.equal(await inFlight, 'already accepted remote receipt');
    const receipt = await h.context.reportEvidence(h.evidence());
    assert.equal(receipt.state, 'QUARANTINED');
    h.release.resolve();
    await until(
      async () => h.stops,
      (count) => count === 1,
      'cancel cleanup',
    );
    assert.equal(paidCalls, 1);
    assert.equal(h.executions, 1);
    assert.equal(
      h.traffic.filter((r) => r.type === 'result.proposed').length,
      0,
    );
    assert.equal(
      await h.db.outboxEvent.count({
        where: {
          aggregateId: h.grant.assignmentId,
          topic: 'runner.result-proposed',
        },
      }),
      0,
    );
    assert.equal((await h.readAssignment()).proposal, null);
    const held = await h.db.reservation.findFirstOrThrow({
      where: { executionId: h.executionId },
    });
    assert.equal(held.heldUnits, 10n);
    assert.equal(
      await h.db.ledgerEntry.count({ where: { executionId: h.executionId } }),
      0,
    );
    assert.ok(
      h.traffic.some(
        (r) =>
          r.target === 0 && r.path.endsWith('/activate') && r.status === 409,
      ),
    );
  },
);

test(
  'missing shared Redis lease cannot be recreated; reaper fences old worker and late evidence survives',
  { timeout: 60_000 },
  async (t) => {
    const h = await workerFixture(t);
    await h.start();
    let paidCalls = 0;
    let finish!: () => void;
    const remote = new Promise<string>((resolve) => {
      finish = () => resolve('late remote receipt');
    });
    const inFlight = h.context.runStep(async () => {
      paidCalls++;
      return remote;
    });
    await until(
      async () => paidCalls,
      (count) => count === 1,
      'in-flight fixture provider call',
    );
    const before = await h.readAssignment();
    const key = `ai-runtime:m3:lease:${h.executionId}`;
    assert.ok((await h.redis.pTTL(key)) > 0);
    assert.equal(await h.redis.del(key), 1);
    h.switchToPeer();
    await assert.rejects(
      h.context.runStep(async () => {
        paidCalls++;
      }),
    );
    assert.equal(h.context.signal.aborted, true);
    assert.equal(await h.redis.exists(key), 0);
    await until(
      h.readAssignment,
      (row) => row.state === 'FENCED',
      'durable orphan fence',
      // Query eligibility is assignment.updated_at + 15s; the API scans every
      // 5s. Allow 5s for CI scheduling/DB latency beyond that nominal 20s bound.
      15_000 + 5_000 + 5_000,
    );
    const execution = await h.db.execution.findUniqueOrThrow({
      where: { id: h.executionId },
    });
    assert.equal(execution.status, 'RECONCILING');
    assert.ok(execution.assignmentGeneration > before.generation);
    const attempt = await h.db.attempt.findUniqueOrThrow({
      where: { id: h.grant.attemptId },
    });
    assert.equal(attempt.status, 'ORPHAN_SUSPENDED');
    assert.equal(attempt.authority, 'FENCED');
    assert.equal(attempt.external, 'UNKNOWN');
    const held = await h.db.reservation.findFirstOrThrow({
      where: { executionId: h.executionId },
    });
    assert.equal(held.heldUnits, 10n);
    assert.equal(held.state, 'PENDING_RECONCILIATION');
    finish();
    assert.equal(await inFlight, 'late remote receipt');
    const receipt = await h.context.reportEvidence(h.evidence());
    assert.equal(receipt.state, 'QUARANTINED');
    assert.equal(receipt.stale, true);
    h.release.resolve();
    await h.worker.stop();
    let replacements = 0;
    const replacement = h.makeWorker(async () => {
      replacements++;
    });
    assert.notEqual(replacement.identity.bootId, h.worker.identity.bootId);
    await replacement.start();
    await until(
      async () =>
        h.traffic.filter((r) => r.path.endsWith('/claim') && r.target === 1)
          .length,
      (count) => count >= 1,
      'replacement claim',
    );
    await replacement.stop();
    assert.equal(replacements, 0);
    assert.equal(paidCalls, 1);
    assert.equal(
      await h.db.runnerAssignment.count({
        where: { executionId: h.executionId },
      }),
      1,
    );
    assert.equal(
      await h.db.attempt.count({ where: { executionId: h.executionId } }),
      1,
    );
    assert.equal(await h.redis.exists(key), 0);
    assert.equal(
      h.traffic.filter((r) => r.type === 'result.proposed').length,
      0,
    );
    assert.equal(
      await h.db.ledgerEntry.count({ where: { executionId: h.executionId } }),
      0,
    );
  },
);

test(
  'lost result ACK after real PostgreSQL commit does not repeat proposal or runtime',
  { timeout: 45_000 },
  async (t) => {
    const h = await workerFixture(t, { dropProposalAck: true });
    await h.start();
    h.release.resolve();
    await until(
      h.readAssignment,
      (row) => row.state === 'RESULT_PROPOSED',
      'committed result proposal',
    );
    await until(
      async () => h.stops,
      (count) => count === 1,
      'ambiguous report cleanup',
    );
    assert.equal(
      h.traffic.filter((r) => r.type === 'result.proposed').length,
      1,
    );
    assert.equal(
      h.traffic.filter((r) => r.type === 'result.proposed' && r.dropped).length,
      1,
    );
    await h.worker.stop();
    assert.equal(h.executions, 1);
    assert.equal(h.launches, 1);
    assert.equal(
      await h.db.outboxEvent.count({
        where: {
          aggregateId: h.grant.assignmentId,
          topic: 'runner.result-proposed',
        },
      }),
      1,
    );
    assert.equal(
      await h.db.runnerAssignment.count({
        where: { executionId: h.executionId },
      }),
      1,
    );
    assert.equal(
      (await h.db.execution.findUniqueOrThrow({ where: { id: h.executionId } }))
        .status,
      'RUNNING',
    );
  },
);
