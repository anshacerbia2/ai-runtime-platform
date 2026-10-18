import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import type { LateEvidence } from '@ai-runtime/contracts/http';
import {
  RunnerEvidenceCollector,
  type EvidenceCipher,
  type EvidenceSpool,
} from '../src/runner-evidence-collector.js';

const message = (): LateEvidence => {
  const executionId = randomUUID();
  const attemptId = randomUUID();
  return {
    token: {
      assignmentId: randomUUID(),
      executionId,
      attemptId,
      runnerId: 'runner-one',
      generation: 1,
      epoch: 1,
    },
    evidence: {
      executionId,
      attemptId,
      sourceEventId: 'provider-call',
      sourceRevision: 1,
      coverage: ['provider-call'],
      cumulativeUnits: null,
      completeness: 'unknown',
      costBasis: 'unknown',
      reason: 'unknown usage',
    },
  };
};

// Orchestration double only; Linux file tests separately prove encrypted storage.
function fixture() {
  const rows = new Map<string, Uint8Array>();
  const events: string[] = [];
  let unavailable = false;
  let invalidReceipt = false;
  let storageFailed = false;
  const received: LateEvidence[] = [];
  const receipt = {
    id: randomUUID(),
    state: 'QUARANTINED',
    replayed: false,
    stale: true,
  };
  const spool: EvidenceSpool = {
    ids: () => [...rows.keys()],
    read: (id) => rows.get(id)!.slice(),
    put(id, bytes) {
      events.push('persist');
      if (storageFailed) {
        throw new Error('sensitive storage failure');
      }
      assert.equal(rows.has(id), false);
      rows.set(id, Uint8Array.from(bytes));
    },
    remove(id) {
      events.push('remove');
      if (storageFailed) {
        throw new Error('sensitive storage failure');
      }
      rows.delete(id);
    },
  };
  const cipher: EvidenceCipher = {
    async seal(bytes) {
      return Uint8Array.from(bytes);
    },
    async open(bytes) {
      return Uint8Array.from(bytes);
    },
  };
  const options = {
    runnerId: 'runner-one',
    ownerSubject: 'owner-one',
    spool,
    cipher,
    http: {
      origin: 'https://runner.example',
      timeoutMs: 100,
      bearerToken: async () => 'fixture-token',
      fetchImpl: async (
        _input: Parameters<typeof fetch>[0],
        init?: RequestInit,
      ) => {
        events.push('send');
        assert.equal(rows.size, 1);
        received.push(JSON.parse(String(init?.body)) as LateEvidence);
        if (unavailable) {
          throw new Error('ambiguous ACK');
        }
        return Response.json(invalidReceipt ? { state: 'SUCCESS' } : receipt, {
          status: 202,
        });
      },
    },
  };
  return {
    rows,
    events,
    options,
    received,
    receipt,
    failNetwork: () => {
      unavailable = true;
    },
    restoreNetwork: () => {
      unavailable = false;
    },
    invalidReceipt: () => {
      invalidReceipt = true;
    },
    failStorage: () => {
      storageFailed = true;
    },
  };
}

test('evidence is persisted before HTTP and removed only after a valid quarantined receipt', async () => {
  const h = fixture();
  const collector = await RunnerEvidenceCollector.open(h.options);
  assert.equal(collector.readyForWork, true);
  const value = message();
  assert.deepEqual(await collector.report(value), h.receipt);
  assert.deepEqual(h.events, ['persist', 'send', 'remove']);
  assert.deepEqual(h.received, [value]);
  assert.equal(collector.readyForWork, true);
});

test('lost ACK survives collector recreation and explicit replay preserves the entire old token and unknown usage', async () => {
  const h = fixture();
  const collector = await RunnerEvidenceCollector.open(h.options);
  const value = message();
  h.failNetwork();
  await assert.rejects(
    collector.report(value),
    /Evidence collection unavailable/,
  );
  assert.equal(h.rows.size, 1);
  assert.equal(collector.readyForWork, false);
  h.restoreNetwork();
  const recovered = await RunnerEvidenceCollector.open(h.options);
  assert.equal(recovered.readyForWork, false);
  assert.equal(await recovered.flush(), 1);
  assert.deepEqual(h.received, [value, value]);
  assert.equal(h.rows.size, 0);
  assert.equal(recovered.readyForWork, true);
});

test('invalid ACK and caller abort retain evidence; abort never cancels the durable append', async () => {
  const h = fixture();
  const collector = await RunnerEvidenceCollector.open(h.options);
  h.invalidReceipt();
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(collector.report(message(), abort.signal));
  assert.equal(h.rows.size, 1);
  assert.equal(h.received.length, 0);
  await assert.rejects(collector.flush());
  assert.equal(h.rows.size, 1);
});

test('same event revision with different content is a conflict, never an overwrite or send', async () => {
  const h = fixture();
  const collector = await RunnerEvidenceCollector.open(h.options);
  const value = message();
  h.failNetwork();
  await assert.rejects(collector.report(value));
  const retained = [...h.rows.values()][0]!.slice();
  await assert.rejects(
    collector.report({
      ...value,
      evidence: { ...value.evidence, reason: 'different' },
    }),
  );
  assert.deepEqual([...h.rows.values()][0], retained);
  assert.equal(h.received.length, 1);
});

test('storage failure sends nothing and poisons readiness without leaking underlying errors', async () => {
  const h = fixture();
  const collector = await RunnerEvidenceCollector.open(h.options);
  h.failStorage();
  await assert.rejects(
    collector.report(message()),
    /^Error: Evidence collection unavailable\.$/,
  );
  assert.equal(h.received.length, 0);
  assert.equal(collector.readyForWork, false);
});

test('foreign runner, mismatched scope and corrupt recovery fail closed', async () => {
  const h = fixture();
  const collector = await RunnerEvidenceCollector.open(h.options);
  const value = message();
  await assert.rejects(
    collector.report({
      ...value,
      token: { ...value.token, runnerId: 'foreign' },
    }),
  );
  await assert.rejects(
    collector.report({
      ...value,
      evidence: { ...value.evidence, attemptId: randomUUID() },
    }),
  );
  assert.equal(h.received.length, 0);
  assert.equal(h.rows.size, 0);
  h.rows.set('a'.repeat(64), new Uint8Array([0]));
  await assert.rejects(RunnerEvidenceCollector.open(h.options));
});

test('receipt followed by failed durable deletion keeps readiness sealed for recovery', async () => {
  const h = fixture();
  const collector = await RunnerEvidenceCollector.open(h.options);
  h.options.spool.remove = () => {
    throw new Error('disk sync failure');
  };
  await assert.rejects(collector.report(message()));
  assert.equal(h.received.length, 1);
  assert.equal(h.rows.size, 1);
  assert.equal(collector.readyForWork, false);
  await assert.rejects(collector.flush());
});

test('caller mutation during encryption cannot change the event sent or retained', async () => {
  const h = fixture();
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  h.options.cipher.seal = async (bytes) => {
    await wait;
    return Uint8Array.from(bytes);
  };
  const collector = await RunnerEvidenceCollector.open(h.options);
  const value = message();
  const expected = structuredClone(value);
  const job = collector.report(value);
  value.evidence.reason = 'changed after dispatch';
  value.token.generation = 2;
  release();
  await job;
  assert.deepEqual(h.received, [expected]);
});

test('encryption failure and oversize ciphertext send nothing and require host recovery', async () => {
  for (const seal of [
    async () => {
      throw new Error('key service unavailable');
    },
    async () => new Uint8Array(65537),
  ]) {
    const h = fixture();
    h.options.cipher.seal = seal;
    const collector = await RunnerEvidenceCollector.open(h.options);
    await assert.rejects(collector.report(message()));
    assert.equal(h.received.length, 0);
    assert.equal(collector.readyForWork, false);
    assert.equal(h.rows.size, 0);
  }
});

test('pending encryption blocks paid work; concurrent intake is bounded without a queue', async () => {
  const h = fixture();
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  h.options.cipher.seal = async (bytes) => {
    await pending;
    return bytes.slice();
  };
  const collector = await RunnerEvidenceCollector.open(h.options);
  const jobs = Array.from({ length: 8 }, () => collector.report(message()));
  assert.equal(collector.readyForWork, false);
  await assert.rejects(collector.report(message()));
  h.failNetwork();
  release();
  await Promise.allSettled(jobs);
  assert.equal(h.rows.size, 8);
  assert.equal(collector.readyForWork, false);
});
