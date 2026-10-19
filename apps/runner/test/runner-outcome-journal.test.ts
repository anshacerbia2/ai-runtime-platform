import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import {
  RunnerOutcomeJournal,
  type RunnerOutcomeBinding,
} from '../src/runner-outcome-journal.js';
import { fixtureCipher, fixtureEvidence } from './support/evidence-fixture.js';

function fixture(maxAssignments = 2) {
  const rows = new Map<string, Uint8Array>();
  let failed = false;
  const options = {
    runnerId: 'runner-one',
    ownerSubject: 'owner-one',
    maxAssignments,
    timeoutMs: 100,
    cipher: fixtureCipher(randomBytes(32)),
    spool: {
      limits: {
        maxRecords: maxAssignments * 2,
        maxBytes: maxAssignments * 131072,
      },
      ids: () => [...rows.keys()],
      read: (id: string) => Uint8Array.from(rows.get(id)!),
      put: (id: string, bytes: Uint8Array) => {
        if (failed) {
          throw new Error('sensitive disk error');
        }
        assert.equal(rows.has(id), false);
        rows.set(id, Uint8Array.from(bytes));
      },
      remove: () => {
        throw new Error('journal records must not be deleted');
      },
    },
  };
  const binding = (): RunnerOutcomeBinding => ({
    token: fixtureEvidence().token,
    bootId: randomUUID(),
    registrationRevision: 1,
  });
  return {
    rows,
    options,
    binding,
    failStorage: () => {
      failed = true;
    },
  };
}
const proposal = () => ({
  outcome: 'completed' as const,
  digest: 'a'.repeat(64),
  artifactIds: [],
  summary: 'sensitive candidate result',
});

test('candidate and stop survive journal reopen, without enabling another boot or automatic replay', async () => {
  const h = fixture();
  const journal = await RunnerOutcomeJournal.open(h.options);
  const binding = h.binding();
  journal.track(binding);
  const candidate = proposal();
  await journal.captureResult(binding, candidate);
  await journal.recordStop(binding, {
    state: 'TERMINATED',
    method: 'OBSERVED',
  });
  assert.equal(h.rows.size, 2);
  const recovered = await RunnerOutcomeJournal.open(h.options);
  assert.equal(recovered.readyForWork, false);
  assert.equal(recovered.canAcceptAssignment, false);
  const records = await Promise.all(
    recovered.ids().map((id) => recovered.read(id)),
  );
  assert.deepEqual(
    records.find((r) => r.type === 'result.candidate')!.binding,
    binding,
  );
  assert.deepEqual(
    records.find((r) => r.type === 'result.candidate')!.proposal,
    candidate,
  );
  assert.deepEqual(records.find((r) => r.type === 'local.stop')!.evidence, {
    state: 'TERMINATED',
    method: 'OBSERVED',
  });
  assert.equal(JSON.stringify(records).includes('nonce'), false);
  assert.equal(JSON.stringify(records).includes('bearer'), false);
});

test('two worst-case record slots are reserved per assignment before launch; no eviction at capacity', async () => {
  const h = fixture(1);
  const journal = await RunnerOutcomeJournal.open(h.options);
  const binding = h.binding();
  journal.track(binding);
  assert.equal(journal.canAcceptAssignment, false);
  assert.equal(journal.readyForWork, true);
  assert.throws(() => journal.track(h.binding()));
  await journal.captureResult(binding, proposal());
  await journal.recordStop(binding, { state: 'UNCONFIRMED', method: null });
  assert.equal(h.rows.size, 2);
  await assert.rejects(
    RunnerOutcomeJournal.open({ ...h.options, maxAssignments: 2 }),
  );
});

test('same candidate is idempotent; changed result or stop evidence cannot overwrite', async () => {
  const h = fixture();
  const journal = await RunnerOutcomeJournal.open(h.options);
  const binding = h.binding();
  journal.track(binding);
  await journal.captureResult(binding, proposal());
  await journal.captureResult(binding, proposal());
  await assert.rejects(
    journal.captureResult(binding, {
      ...proposal(),
      summary: 'different candidate',
    }),
  );
  assert.equal(h.rows.size, 1);
});

test('unconfirmed stop is retained as unknown and never promoted to termination', async () => {
  const h = fixture();
  const journal = await RunnerOutcomeJournal.open(h.options);
  const binding = h.binding();
  journal.track(binding);
  await journal.recordStop(binding, { state: 'UNCONFIRMED', method: null });
  await assert.rejects(
    journal.recordStop(binding, { state: 'TERMINATED', method: 'GRACEFUL' }),
  );
  const record = await journal.read(journal.ids()[0]!);
  assert.equal(record.type, 'local.stop');
  assert.deepEqual(record.evidence, { state: 'UNCONFIRMED', method: null });
});

test('disk/key failure is observable, sanitized and seals further work without claiming a receipt', async () => {
  const h = fixture();
  const journal = await RunnerOutcomeJournal.open(h.options);
  const binding = h.binding();
  journal.track(binding);
  h.failStorage();
  await assert.rejects(
    journal.captureResult(binding, proposal()),
    /^Error: Runner outcome journal unavailable\.$/,
  );
  assert.equal(journal.readyForWork, false);
  await assert.rejects(
    journal.recordStop(binding, { state: 'TERMINATED', method: 'OBSERVED' }),
  );
  assert.equal(h.rows.size, 0);
});

test('late encryption response cannot append after a bounded checkpoint timeout', async () => {
  const h = fixture();
  let complete!: (bytes: Uint8Array) => void;
  const encrypted = new Promise<Uint8Array>((resolve) => {
    complete = resolve;
  });
  h.options.cipher.seal = async () => encrypted;
  const journal = await RunnerOutcomeJournal.open(h.options);
  const binding = h.binding();
  journal.track(binding);
  await assert.rejects(journal.captureResult(binding, proposal()));
  const bytes = new Uint8Array([1, 2, 3]);
  complete(bytes);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(bytes, new Uint8Array(3));
  assert.equal(h.rows.size, 0);
  assert.equal(journal.readyForWork, false);
});

test('scope/key/record corruption and invalid stop combinations fail closed', async () => {
  const h = fixture();
  const journal = await RunnerOutcomeJournal.open(h.options);
  const binding = h.binding();
  assert.throws(() =>
    journal.track({
      ...binding,
      token: { ...binding.token, runnerId: 'foreign' },
    }),
  );
  journal.track(binding);
  await assert.rejects(
    journal.recordStop(binding, { state: 'TERMINATED', method: null }),
  );
  await journal.captureResult(binding, proposal());
  await assert.rejects(
    RunnerOutcomeJournal.open({ ...h.options, ownerSubject: 'foreign-owner' }),
  );
  const id = journal.ids()[0]!;
  const corrupt = h.rows.get(id)!;
  corrupt[0] = corrupt[0]! ^ 1;
  await assert.rejects(RunnerOutcomeJournal.open(h.options));
});
