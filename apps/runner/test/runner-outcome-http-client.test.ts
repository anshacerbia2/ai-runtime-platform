import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import { canonicalJson } from '@ai-runtime/contracts';
import { apiContract } from '@ai-runtime/contracts/http';
import { RunnerOutcomeHttpClient } from '../src/runner-outcome-http-client.js';
import { fixtureEvidence } from './support/evidence-fixture.js';

const binding = () => ({
  token: fixtureEvidence().token,
  bootId: randomUUID(),
  registrationRevision: 1,
});
const proposal = {
  outcome: 'completed' as const,
  digest: 'a'.repeat(64),
  artifactIds: [],
  summary: 'private result summary',
};

test('client submits quarantine stop and only a canonical proposal hash for reconciliation, without live lease or result retry', async () => {
  const scope = binding();
  const bodies: Record<string, unknown>[] = [];
  const paths: string[] = [];
  const client = new RunnerOutcomeHttpClient(scope, {
    origin: 'https://runner.example',
    timeoutMs: 100,
    bearerToken: async () => 'fixture-token',
    fetchImpl: async (input, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      bodies.push(body);
      paths.push(new URL(String(input)).pathname);
      return paths.length === 1
        ? Response.json(
            {
              id: randomUUID(),
              binding: scope,
              evidence: body.evidence,
              state: 'QUARANTINED',
              replayed: true,
              stale: true,
            },
            { status: 202 },
          )
        : Response.json({
            binding: scope,
            proposalDigest: body.proposalDigest,
            state: 'MATCHED',
            stale: true,
          });
    },
  });
  assert.equal(
    (await client.stop({ state: 'UNCONFIRMED', method: null })).state,
    'QUARANTINED',
  );
  assert.equal((await client.reconcileResult(proposal)).state, 'MATCHED');
  assert.equal(paths[0], apiContract.runner.stop.path);
  assert.equal(paths[1], apiContract.runner.reconcileResult.path);
  assert.equal(
    bodies[1]!.proposalDigest,
    createHash('sha256').update(canonicalJson(proposal)).digest('hex'),
  );
  assert.equal(JSON.stringify(bodies).includes(proposal.summary), false);
  assert.equal(JSON.stringify(bodies).includes('nonce'), false);
  assert.equal(JSON.stringify(bodies).includes('fixture-token'), false);
});

test('foreign binding or digest receipt is rejected, and lost stop ACK is sent once', async () => {
  const scope = binding();
  let calls = 0;
  const client = new RunnerOutcomeHttpClient(scope, {
    origin: 'https://runner.example',
    timeoutMs: 100,
    bearerToken: async () => 'fixture-token',
    fetchImpl: async (_input, init) => {
      calls++;
      if (calls === 1) {
        throw new Error('lost ACK');
      }
      return Response.json({
        binding: calls === 2 ? { ...scope, bootId: randomUUID() } : scope,
        proposalDigest:
          calls === 2
            ? (JSON.parse(String(init?.body)) as { proposalDigest: string })
                .proposalDigest
            : 'b'.repeat(64),
        state: 'MATCHED',
        stale: false,
      });
    },
  });
  await assert.rejects(
    client.stop({ state: 'TERMINATED', method: 'OBSERVED' }),
  );
  assert.equal(calls, 1);
  await assert.rejects(client.reconcileResult(proposal));
  assert.equal(calls, 2);
  await assert.rejects(client.reconcileResult(proposal));
  assert.equal(calls, 3);
});
