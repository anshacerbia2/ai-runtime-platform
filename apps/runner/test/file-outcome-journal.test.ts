import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { FileEvidenceSpool } from '../src/file-evidence-spool.js';
import {
  RunnerOutcomeJournal,
  type RunnerOutcomeBinding,
} from '../src/runner-outcome-journal.js';
import type { RunnerResultProposal } from '../src/runner-report-http-client.js';
import { fixtureCipher } from './support/evidence-fixture.js';

for (const stage of ['candidate', 'stop'] as const) {
  test(
    `SIGKILL after ${stage} checkpoint preserves immutable encrypted outcomes without inferring missing termination`,
    { skip: process.platform !== 'linux', timeout: 15000 },
    async (t) => {
      const directory = mkdtempSync(join(tmpdir(), 'runner-outcomes-'));
      chmodSync(directory, 0o700);
      const resources: { spool?: FileEvidenceSpool } = {};
      t.after(() => {
        resources.spool?.close();
        rmSync(directory, { recursive: true, force: true });
      });
      const key = randomBytes(32);
      const child = fork(
        new URL('./support/outcome-crash.fixture.ts', import.meta.url),
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
      const saved = once(child, 'message');
      child.send({ directory, key: key.toString('base64'), stage });
      const [raw] = await saved;
      const value = raw as {
        type: string;
        binding: RunnerOutcomeBinding;
        proposal: RunnerResultProposal;
      };
      assert.equal(value.type, 'persisted');
      const exited = once(child, 'exit');
      child.kill('SIGKILL');
      await exited;
      const options = { directory, maxRecords: 4, maxBytes: 262144 };
      assert.throws(() => new FileEvidenceSpool(options));
      // This fixture observed termination of the exact owner; no PID/TTL takeover.
      unlinkSync(join(directory, 'writer.lock'));
      const spool = new FileEvidenceSpool(options);
      resources.spool = spool;
      const journal = await RunnerOutcomeJournal.open({
        runnerId: 'runner-one',
        ownerSubject: 'owner-one',
        spool,
        cipher: fixtureCipher(key),
        maxAssignments: 2,
        timeoutMs: 1000,
      });
      assert.equal(journal.readyForWork, false);
      assert.equal(journal.ids().length, stage === 'stop' ? 2 : 1);
      const records = await Promise.all(
        journal.ids().map((id) => journal.read(id)),
      );
      const candidate = records.find(
        (record) => record.type === 'result.candidate',
      )!;
      assert.deepEqual(candidate.binding, value.binding);
      assert.deepEqual(candidate.proposal, value.proposal);
      const stopped = records.find((record) => record.type === 'local.stop');
      assert.deepEqual(
        stopped?.evidence,
        stage === 'stop' ? { state: 'UNCONFIRMED', method: null } : undefined,
      );
      for (const id of journal.ids()) {
        const bytes = readFileSync(join(directory, `${id}.evidence`));
        assert.equal(
          bytes.includes(Buffer.from(value.proposal.summary)),
          false,
        );
        assert.equal(bytes.includes(Buffer.from(value.binding.bootId)), false);
      }
    },
  );
}
