import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { chmodSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileEvidenceSpool } from '../../apps/runner/src/file-evidence-spool.js';
import { RunnerOutcomeHttpClient } from '../../apps/runner/src/runner-outcome-http-client.js';
import {
  RunnerOutcomeJournal,
  type RunnerOutcomeJournalOptions,
} from '../../apps/runner/src/runner-outcome-journal.js';
import {
  RunnerEvidenceCollector,
  type RunnerEvidenceCollectorOptions,
} from '../../apps/runner/src/runner-evidence-collector.js';
import { fixtureCipher } from '../../apps/runner/test/support/evidence-fixture.js';
import {
  stopInstance,
  until,
  workerFixture,
} from './worker-coordinators.fixture.js';

test(
  'durable encrypted evidence survives lost committed ACK and collector reopen, deduplicating through API B',
  { timeout: 45_000, skip: process.platform !== 'linux' },
  async (t) => {
    const directory = mkdtempSync(join(tmpdir(), 'worker-collector-'));
    chmodSync(directory, 0o700);
    let spool: FileEvidenceSpool | undefined;
    let options: RunnerEvidenceCollectorOptions | undefined;
    t.after(() => {
      spool?.close();
      rmSync(directory, { recursive: true, force: true });
    });
    const h = await workerFixture(t, {
      dropEvidenceAck: true,
      createEvidenceCollector: async (identity) => {
        spool = new FileEvidenceSpool({
          directory,
          maxRecords: 4,
          maxBytes: 262144,
        });
        options = {
          ...identity,
          spool,
          cipher: fixtureCipher(randomBytes(32)),
        };
        return RunnerEvidenceCollector.open(options);
      },
    });
    await h.start();
    await assert.rejects(h.context.reportEvidence(h.evidence()));
    assert.equal(h.evidenceCollector!.readyForWork, false);
    assert.equal(spool!.ids().length, 1);
    const original = await h.db.runnerEvidence.findFirstOrThrow({
      where: { executionId: h.executionId },
    });
    let paid = 0;
    await assert.rejects(
      h.context.runStep(async () => {
        paid++;
      }),
    );
    assert.equal(paid, 0);
    await h.worker.stop();
    spool!.close();
    h.switchToPeer();
    await stopInstance(h.instances[0]!);
    spool = new FileEvidenceSpool({
      directory,
      maxRecords: 4,
      maxBytes: 262144,
    });
    const recovered = await RunnerEvidenceCollector.open({
      ...options!,
      spool,
    });
    assert.equal(await recovered.flush(), 1);
    assert.deepEqual(spool.ids(), []);
    assert.equal(recovered.readyForWork, true);
    const rows = await h.db.runnerEvidence.findMany({
      where: { executionId: h.executionId },
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.id, original.id);
    assert.equal(h.executions, 1);
    assert.equal(h.launches, 1);
    assert.equal(
      h.traffic.filter((r) => r.path.endsWith('/evidence') && r.dropped).length,
      1,
    );
    assert.ok(
      h.traffic.some(
        (r) =>
          r.target === 1 && r.path.endsWith('/evidence') && r.status === 202,
      ),
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
    assert.equal(
      h.traffic.some((r) => r.type === 'result.proposed'),
      false,
    );
  },
);

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
    let spool: FileEvidenceSpool | undefined;
    let journalOptions: RunnerOutcomeJournalOptions | undefined;
    let directory: string | undefined;
    if (process.platform === 'linux') {
      directory = mkdtempSync(join(tmpdir(), 'worker-outcomes-'));
      chmodSync(directory, 0o700);
      t.after(() => {
        spool?.close();
        rmSync(directory!, { recursive: true, force: true });
      });
    }
    const h = await workerFixture(t, {
      dropProposalAck: true,
      createOutcomeJournal: directory
        ? async (identity) => {
            spool = new FileEvidenceSpool({
              directory: directory!,
              maxRecords: 4,
              maxBytes: 262144,
            });
            journalOptions = {
              ...identity,
              spool,
              cipher: fixtureCipher(randomBytes(32)),
              maxAssignments: 2,
              timeoutMs: 1000,
            };
            return RunnerOutcomeJournal.open(journalOptions);
          }
        : undefined,
    });
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
    const stopped = await h.worker.stop();
    if (spool && journalOptions) {
      assert.equal(stopped[0]!.durableReceipt, 'RECORDED');
      assert.equal(stopped[0]!.evidence.state, 'TERMINATED');
      spool.close();
      spool = new FileEvidenceSpool({
        directory: directory!,
        maxRecords: 4,
        maxBytes: 262144,
      });
      const recovered = await RunnerOutcomeJournal.open({
        ...journalOptions,
        spool,
      });
      assert.equal(recovered.readyForWork, false);
      const records = await Promise.all(
        recovered.ids().map((id) => recovered.read(id)),
      );
      const candidate = records.find(
        (record) => record.type === 'result.candidate',
      )!;
      assert.equal(candidate.binding.token.assignmentId, h.grant.assignmentId);
      assert.equal(candidate.binding.bootId, h.worker.identity.bootId);
      assert.equal(candidate.proposal.digest, 'a'.repeat(64));
      assert.equal(
        records.find((record) => record.type === 'local.stop')!.evidence.state,
        'TERMINATED',
      );
      h.switchToPeer();
      const client = new RunnerOutcomeHttpClient(candidate.binding, h.http);
      const matched = await client.reconcileResult(candidate.proposal);
      assert.equal(matched.state, 'MATCHED');
      assert.equal(
        (
          await client.reconcileResult({
            ...candidate.proposal,
            summary: 'different summary',
          })
        ).state,
        'CONFLICT',
      );
      const localStop = records.find((record) => record.type === 'local.stop')!;
      const receipt = await client.stop(localStop.evidence);
      assert.equal(receipt.state, 'QUARANTINED');
      assert.equal((await client.stop(localStop.evidence)).id, receipt.id);
      assert.equal(recovered.ids().length, 2);
      assert.equal(recovered.readyForWork, false);
    }
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

test(
  'lost committed stop ACK replays through API B after cancel without changing authority or budget',
  { timeout: 45000 },
  async (t) => {
    const h = await workerFixture(t, { dropStopAck: true });
    await h.start();
    const row = await h.readAssignment();
    const binding = {
      token: {
        assignmentId: row.id,
        executionId: row.executionId,
        attemptId: row.attemptId,
        runnerId: row.runnerId,
        generation: row.generation,
        epoch: row.epoch,
      },
      bootId: h.worker.identity.bootId,
      registrationRevision: 1,
    };
    const client = new RunnerOutcomeHttpClient(binding, h.http);
    assert.equal(
      (
        await client.reconcileResult({
          outcome: 'completed',
          digest: 'a'.repeat(64),
          artifactIds: [],
          summary: 'not yet proposed',
        })
      ).state,
      'NOT_RECORDED',
    );
    const stopped = await h.worker.stop();
    const evidence = stopped[0]!.evidence;
    await h.redis.del(`ai-runtime:m3:lease:${h.executionId}`);
    await assert.rejects(client.stop(evidence));
    assert.equal(
      await h.db.runnerStopReceipt.count({
        where: { executionId: h.executionId },
      }),
      1,
    );
    h.switchToPeer();
    await stopInstance(h.instances[0]!);
    await h.cancel();
    const controlBefore = await h.db.execution.findUniqueOrThrow({
      where: { id: h.executionId },
    });
    const attemptBefore = await h.db.attempt.findUniqueOrThrow({
      where: { id: row.attemptId },
    });
    const receipt = await client.stop(evidence);
    assert.equal(receipt.replayed, true);
    assert.equal(receipt.stale, true);
    const controlAfter = await h.db.execution.findUniqueOrThrow({
      where: { id: h.executionId },
    });
    const attemptAfter = await h.db.attempt.findUniqueOrThrow({
      where: { id: row.attemptId },
    });
    assert.deepEqual(controlAfter, controlBefore);
    assert.deepEqual(attemptAfter, attemptBefore);
    await assert.rejects(
      new RunnerOutcomeHttpClient(
        { ...binding, bootId: randomUUID() },
        h.http,
      ).stop(evidence),
    );
    assert.equal(
      await h.db.runnerStopReceipt.count({
        where: { executionId: h.executionId },
      }),
      1,
    );
    assert.equal(
      await h.db.outboxEvent.count({
        where: {
          aggregateId: receipt.id,
          topic: 'runner.stop-evidence-received',
        },
      }),
      1,
    );
    const reservation = await h.db.reservation.findFirstOrThrow({
      where: { executionId: h.executionId },
    });
    assert.equal(reservation.heldUnits, 10n);
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
    assert.equal(h.executions, 1);
    assert.equal(h.launches, 1);
    assert.equal(
      h.traffic.filter((item) => item.path.endsWith('/stops') && item.dropped)
        .length,
      1,
    );
  },
);
