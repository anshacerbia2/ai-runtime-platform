import { randomUUID } from 'node:crypto';
import { FileEvidenceSpool } from '../../src/file-evidence-spool.js';
import { RunnerOutcomeJournal } from '../../src/runner-outcome-journal.js';
import { fixtureCipher, fixtureEvidence } from './evidence-fixture.js';

process.once(
  'message',
  async (input: {
    directory: string;
    key: string;
    stage: 'candidate' | 'stop';
  }) => {
    const spool = new FileEvidenceSpool({
      directory: input.directory,
      maxRecords: 4,
      maxBytes: 262144,
    });
    const journal = await RunnerOutcomeJournal.open({
      runnerId: 'runner-one',
      ownerSubject: 'owner-one',
      spool,
      cipher: fixtureCipher(Buffer.from(input.key, 'base64')),
      maxAssignments: 2,
      timeoutMs: 1000,
    });
    const binding = {
      token: fixtureEvidence().token,
      bootId: randomUUID(),
      registrationRevision: 1,
    };
    const proposal = {
      outcome: 'completed' as const,
      digest: 'a'.repeat(64),
      artifactIds: [],
      summary: 'sensitive fixture candidate',
    };
    journal.track(binding);
    await journal.captureResult(binding, proposal);
    if (input.stage === 'stop') {
      await journal.recordStop(binding, { state: 'UNCONFIRMED', method: null });
    }
    process.send?.({ type: 'persisted', binding, proposal });
    setInterval(() => undefined, 1000);
  },
);
