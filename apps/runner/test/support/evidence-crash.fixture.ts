import { FileEvidenceSpool } from '../../src/file-evidence-spool.js';
import { RunnerEvidenceCollector } from '../../src/runner-evidence-collector.js';
import { fixtureCipher, fixtureEvidence } from './evidence-fixture.js';

process.once('message', async (input: { directory: string; key: string }) => {
  const spool = new FileEvidenceSpool({
    directory: input.directory,
    maxRecords: 4,
    maxBytes: 262144,
  });
  const message = fixtureEvidence();
  const collector = await RunnerEvidenceCollector.open({
    runnerId: 'runner-one',
    ownerSubject: 'owner-one',
    spool,
    cipher: fixtureCipher(Buffer.from(input.key, 'base64')),
    http: {
      origin: 'https://runner.example',
      timeoutMs: 3000,
      bearerToken: async () => 'fixture-token',
      fetchImpl: async () => {
        // Network dispatch cannot be reached until file + directory fsync complete.
        process.send?.({ type: 'persisted', message });
        return new Promise<Response>(() => undefined);
      },
    },
  });
  await collector.report(message);
});
