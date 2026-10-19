import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import type { LateEvidence } from '@ai-runtime/contracts/http';
import { FileEvidenceSpool } from '../src/file-evidence-spool.js';
import { RunnerEvidenceCollector } from '../src/runner-evidence-collector.js';
import { fixtureCipher, fixtureEvidence } from './support/evidence-fixture.js';

const linux = { skip: process.platform !== 'linux' };
function directory(t: TestContext): string {
  const root = mkdtempSync(join(tmpdir(), 'runner-evidence-'));
  chmodSync(root, 0o700);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
function store(root: string, maxRecords = 4, maxBytes = 262144) {
  return new FileEvidenceSpool({ directory: root, maxRecords, maxBytes });
}

test(
  'file backend refuses unsupported platforms without touching the path',
  { skip: process.platform === 'linux' },
  () => {
    assert.throws(
      () => store('not-a-directory'),
      /^Error: Evidence spool unavailable\.$/,
    );
  },
);

test(
  'private encrypted files recover after reopen, authenticate identity and never expose plaintext',
  linux,
  async (t) => {
    const root = directory(t);
    const key = randomBytes(32);
    let spool = store(root);
    const value = fixtureEvidence();
    const options = {
      runnerId: 'runner-one',
      ownerSubject: 'owner-one',
      spool,
      cipher: fixtureCipher(key),
      http: {
        origin: 'https://runner.example',
        timeoutMs: 100,
        bearerToken: async () => 'fixture-token',
        fetchImpl: async () => {
          throw new Error('lost ACK');
        },
      },
    };
    const collector = await RunnerEvidenceCollector.open(options);
    await assert.rejects(collector.report(value));
    const id = spool.ids()[0]!;
    const path = join(root, `${id}.evidence`);
    assert.equal(
      readFileSync(path).includes(Buffer.from(value.evidence.reason)),
      false,
    );
    assert.equal(
      readFileSync(path).includes(Buffer.from(value.token.executionId)),
      false,
    );
    assert.equal(statSync(path).mode & 0o077, 0);
    assert.throws(() => store(root));
    spool.close();
    spool = store(root);
    await assert.rejects(
      RunnerEvidenceCollector.open({
        ...options,
        spool,
        ownerSubject: 'different-owner',
      }),
    );
    await assert.rejects(
      RunnerEvidenceCollector.open({
        ...options,
        spool,
        cipher: fixtureCipher(randomBytes(32)),
      }),
    );
    const received: LateEvidence[] = [];
    const recovered = await RunnerEvidenceCollector.open({
      ...options,
      spool,
      http: {
        ...options.http,
        fetchImpl: async (_input, init) => {
          received.push(JSON.parse(String(init?.body)) as LateEvidence);
          return Response.json(
            {
              id: randomUUID(),
              state: 'QUARANTINED',
              replayed: true,
              stale: true,
            },
            { status: 202 },
          );
        },
      },
    });
    assert.equal(await recovered.flush(), 1);
    assert.deepEqual(received, [value]);
    assert.equal(recovered.readyForWork, true);
    assert.deepEqual(spool.ids(), []);
    spool.close();
    assert.deepEqual(readdirSync(root), []);
  },
);

test(
  'capacity is bounded, existing events are immutable and no record is evicted',
  linux,
  (t) => {
    const root = directory(t);
    const spool = store(root, 1, 3);
    const id = 'a'.repeat(64);
    spool.put(id, new Uint8Array([1, 2, 3]));
    assert.throws(() => spool.put(id, new Uint8Array([9])));
    assert.throws(() => spool.put('b'.repeat(64), new Uint8Array([4])));
    assert.deepEqual(spool.read(id), new Uint8Array([1, 2, 3]));
    assert.throws(() => spool.read('../foreign'));
    spool.close();
    assert.throws(() => store(root, 1, 2));
    const recovered = store(root, 1, 3);
    assert.deepEqual(recovered.ids(), [id]);
    recovered.close();
  },
);

test(
  'private directory, symlink and partial/corrupt records fail closed and are preserved',
  linux,
  (t) => {
    const root = directory(t);
    chmodSync(root, 0o755);
    assert.throws(() => store(root));
    chmodSync(root, 0o700);
    const partial = join(root, `${'a'.repeat(64)}.partial`);
    writeFileSync(partial, 'incomplete encrypted append', { mode: 0o600 });
    assert.throws(() => store(root));
    assert.equal(readFileSync(partial, 'utf8'), 'incomplete encrypted append');
    unlinkSync(partial);
    const foreign = join(directory(t), 'foreign');
    writeFileSync(foreign, 'foreign ciphertext', { mode: 0o600 });
    symlinkSync(foreign, join(root, `${'a'.repeat(64)}.evidence`));
    assert.throws(() => store(root));
    assert.equal(readFileSync(foreign, 'utf8'), 'foreign ciphertext');
  },
);

test(
  'SIGKILL after durable append preserves unknown evidence for explicit fenced-owner recovery',
  { ...linux, timeout: 15000 },
  async (t) => {
    const root = directory(t);
    const key = randomBytes(32);
    const child = fork(
      new URL('./support/evidence-crash.fixture.ts', import.meta.url),
      [],
      {
        execArgv: ['--import', 'tsx'],
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      },
    );
    t.after(() => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
      }
    });
    const received = once(child, 'message');
    child.send({ directory: root, key: key.toString('base64') });
    const [raw] = await received;
    const saved = raw as { type: string; message: LateEvidence };
    assert.equal(saved.type, 'persisted');
    const exited = once(child, 'exit');
    child.kill('SIGKILL');
    await exited;
    assert.throws(() => store(root));
    // Test owns and has observed termination of this exact collector process.
    // Production recovery requires the equivalent host/operator ownership proof.
    unlinkSync(join(root, 'writer.lock'));
    const spool = store(root);
    let replay: LateEvidence | undefined;
    const collector = await RunnerEvidenceCollector.open({
      runnerId: 'runner-one',
      ownerSubject: 'owner-one',
      spool,
      cipher: fixtureCipher(key),
      http: {
        origin: 'https://runner.example',
        timeoutMs: 100,
        bearerToken: async () => 'fixture-token',
        fetchImpl: async (_input, init) => {
          replay = JSON.parse(String(init?.body)) as LateEvidence;
          return Response.json(
            {
              id: randomUUID(),
              state: 'QUARANTINED',
              replayed: true,
              stale: true,
            },
            { status: 202 },
          );
        },
      },
    });
    assert.equal(collector.readyForWork, false);
    assert.equal(await collector.flush(), 1);
    assert.deepEqual(replay, saved.message);
    assert.equal(replay!.evidence.cumulativeUnits, null);
    spool.close();
  },
);
