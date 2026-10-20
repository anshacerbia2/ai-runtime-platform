import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { captureRunscIdentity } from '../../apps/runner/src/runsc-sandbox-driver.js';
import { nativeCoordinatorSandbox } from './native-coordinator-sandbox.fixture.js';
import {
  stopInstance,
  until,
  workerFixture,
} from './worker-coordinators.fixture.js';

async function fixture(t: TestContext, dropClaimAck = false) {
  const native = await nativeCoordinatorSandbox();
  t.after(() => native.cleanup());
  const h = await workerFixture(t, {
    dropClaimAck,
    createWorker: native.createWorker,
  });
  await h.start();
  assert.deepEqual(
    native.onlyRecord.identity,
    captureRunscIdentity({ ...h.grant, bootId: h.worker.identity.bootId }),
  );
  assert.equal(await native.status(), 'running');
  return { native, h };
}

async function noSettlement(h: Awaited<ReturnType<typeof workerFixture>>) {
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
    h.traffic.some((row) => row.type === 'result.proposed'),
    false,
  );
  assert.equal((await h.readAssignment()).proposal, null);
}

test(
  'native sandbox survives lost claim ACK and API A exit without a second run; shutdown reaps before unlock',
  { timeout: 60_000 },
  async (t) => {
    const { native, h } = await fixture(t, true);
    const before = await h.readAssignment();
    assert.equal(before.state, 'STARTED');
    assert.ok(before.leaseNonceDigest);
    assert.equal(before.claimBootId, h.worker.identity.bootId);
    assert.equal(
      h.traffic.filter((row) => row.path.endsWith('/claim') && row.dropped)
        .length,
      1,
    );
    h.switchToPeer();
    await stopInstance(h.instances[0]!);
    let calls = 0;
    assert.equal(
      await h.context.runStep(async () => {
        calls++;
        return 'inert-receipt';
      }),
      'inert-receipt',
    );
    assert.equal(await native.status(), 'running');
    const after = await h.readAssignment();
    assert.equal(after.leaseNonceDigest, before.leaseNonceDigest);
    assert.equal(after.claimBootId, before.claimBootId);
    assert.equal(after.generation, before.generation);
    const closed = await h.worker.close();
    assert.equal(closed.ownership, 'RELEASED');
    assert.equal(closed.assignments[0]!.evidence.state, 'TERMINATED');
    await native.assertClean(0);
    assert.equal(native.starts, 1);
    assert.equal(h.executions, 1);
    assert.equal(calls, 1);
    assert.ok(
      h.traffic.some(
        (row) =>
          row.target === 1 &&
          row.path.endsWith('/activate') &&
          row.status === 200,
      ),
    );
    assert.equal(
      (
        await h.db.reservation.findFirstOrThrow({
          where: { executionId: h.executionId },
        })
      ).heldUnits,
      10n,
    );
    await noSettlement(h);
  },
);

test(
  'cancel committed on API B denies the next native-worker step, stops the real subtree and keeps late usage unknown',
  { timeout: 60_000 },
  async (t) => {
    const { native, h } = await fixture(t);
    let calls = 0;
    let finish!: () => void;
    const remote = new Promise<string>((resolve) => {
      finish = () => resolve('previously accepted inert receipt');
    });
    const inFlight = h.context.runStep(async () => {
      calls++;
      return remote;
    });
    await until(
      async () => calls,
      (count) => count === 1,
      'inert in-flight step',
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
        calls++;
      }),
    );
    assert.equal(h.context.signal.aborted, true);
    const closed = await h.worker.close();
    assert.equal(closed.ownership, 'RELEASED');
    assert.equal(closed.assignments[0]!.evidence.state, 'TERMINATED');
    await native.assertClean(0);
    finish();
    assert.equal(await inFlight, 'previously accepted inert receipt');
    h.switchToPeer();
    const receipt = await h.context.reportEvidence(h.evidence());
    assert.equal(receipt.state, 'QUARANTINED');
    const evidence = await h.db.runnerEvidence.findFirstOrThrow({
      where: { executionId: h.executionId },
    });
    assert.ok(
      evidence.payload &&
        typeof evidence.payload === 'object' &&
        !Array.isArray(evidence.payload),
    );
    assert.equal(evidence.payload.costBasis, 'unknown');
    assert.equal(calls, 1);
    assert.equal(native.starts, 1);
    assert.equal(h.executions, 1);
    assert.ok(
      h.traffic.some(
        (row) =>
          row.target === 0 &&
          row.path.endsWith('/activate') &&
          row.status === 409,
      ),
    );
    assert.equal(
      (
        await h.db.reservation.findFirstOrThrow({
          where: { executionId: h.executionId },
        })
      ).heldUnits,
      10n,
    );
    await noSettlement(h);
  },
);

test(
  'missing real Redis lease fences a native worker; a fresh boot cannot launch a replacement or release held cost',
  { timeout: 75_000 },
  async (t) => {
    const { native, h } = await fixture(t);
    const before = await h.readAssignment();
    const key = `ai-runtime:m3:lease:${h.executionId}`;
    assert.ok((await h.redis.pTTL(key)) > 0);
    assert.equal(await h.redis.del(key), 1);
    h.switchToPeer();
    let calls = 0;
    await assert.rejects(
      h.context.runStep(async () => {
        calls++;
      }),
    );
    assert.equal(h.context.signal.aborted, true);
    const closed = await h.worker.close();
    assert.equal(closed.ownership, 'RELEASED');
    assert.equal(closed.assignments[0]!.evidence.state, 'TERMINATED');
    await native.assertClean(0);
    assert.equal(await h.redis.exists(key), 0);
    await until(
      h.readAssignment,
      (row) => row.state === 'FENCED',
      'durable native-worker orphan fence',
      25_000,
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
    assert.equal(held.state, 'PENDING_RECONCILIATION');
    assert.equal(held.heldUnits, 10n);
    const late = await h.context.reportEvidence(h.evidence());
    assert.equal(late.state, 'QUARANTINED');
    assert.equal(late.stale, true);
    let replacements = 0;
    const claimsBefore = h.traffic.filter(
      (row) => row.target === 1 && row.path.endsWith('/claim'),
    ).length;
    const replacement = await h.makeOwnedWorker(async () => {
      replacements++;
    });
    assert.notEqual(replacement.identity.bootId, h.worker.identity.bootId);
    await replacement.start();
    await until(
      async () =>
        h.traffic.filter(
          (row) => row.target === 1 && row.path.endsWith('/claim'),
        ).length,
      (count) => count > claimsBefore,
      'fresh native-host boot claim',
    );
    assert.equal((await replacement.close()).ownership, 'RELEASED');
    await native.assertClean(1);
    assert.equal(replacements, 0);
    assert.equal(calls, 0);
    assert.equal(native.starts, 1);
    assert.equal(h.executions, 1);
    assert.equal(await h.redis.exists(key), 0);
    await noSettlement(h);
  },
);
