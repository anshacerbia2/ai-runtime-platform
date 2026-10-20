import type { UsageCommand } from '@ai-runtime/contracts';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import type { RunnerDispatchGrant } from '@ai-runtime/contracts/http';
import type { RunnerResultProposal } from '../src/runner-report-http-client.js';
import {
  RunnerWorker,
  type RunnerStepContext,
  type RunnerWorkerOptions,
} from '../src/runner-worker.js';
import type { LeaseTimerPort } from '../src/runner-lease-loop.js';
import { materializePluginBundle } from '../src/plugin-bundle.js';
import { RunnerEvidenceCollector } from '../src/runner-evidence-collector.js';
import { fixtureCipher } from './support/evidence-fixture.js';
import { RunnerOutcomeJournal } from '../src/runner-outcome-journal.js';
import {
  RunscSandboxDriver,
  type RunscLaunchRecord,
} from '../src/runsc-sandbox-driver.js';
import type { SandboxDriver } from '../src/sandbox-supervisor.js';

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

async function journalFixture(maxAssignments = 2) {
  const rows = new Map<string, Uint8Array>();
  let failed = false;
  const options = {
    runnerId: 'worker-one',
    ownerSubject: 'owner-one',
    maxAssignments,
    timeoutMs: 100,
    cipher: fixtureCipher(new Uint8Array(32).fill(9)),
    spool: {
      limits: {
        maxRecords: maxAssignments * 2,
        maxBytes: maxAssignments * 131072,
      },
      ids: () => [...rows.keys()],
      read: (id: string) => Uint8Array.from(rows.get(id)!),
      put: (id: string, bytes: Uint8Array) => {
        if (failed) {
          throw new Error('disk failure');
        }
        rows.set(id, Uint8Array.from(bytes));
      },
      remove: () => {
        throw new Error('no journal deletion');
      },
    },
  };
  const journal = await RunnerOutcomeJournal.open(options);
  return {
    journal,
    rows,
    options,
    failStorage: () => {
      failed = true;
    },
  };
}

test('worker durably captures candidate before ambiguous proposal and records cleanup exactly once', async (t) => {
  const j = await journalFixture();
  let proposed = 0;
  const h = harness(t, {
    grants: [grant()],
    outcomeJournal: j.journal,
    execute: async () => resultProposal(),
    reporting: async () => {
      proposed++;
      assert.equal(j.rows.size, 1);
      const candidate = await j.journal.read(j.journal.ids()[0]!);
      assert.equal(candidate.type, 'result.candidate');
      throw new Error('ACK lost after commit');
    },
  });
  await h.worker.start();
  h.timers.advanceTo(0);
  await flush();
  const stopped = await h.worker.stop();
  assert.equal(proposed, 1);
  assert.equal(j.rows.size, 2);
  assert.equal(stopped[0]!.durableReceipt, 'RECORDED');
  assert.equal(stopped[0]!.evidence.state, 'TERMINATED');
  assert.equal(h.stops, 1);
  const recovered = await RunnerOutcomeJournal.open(j.options);
  assert.equal(recovered.readyForWork, false);
});

test('a late candidate after local stop is retained without reopening or resending the proposal', async (t) => {
  const j = await journalFixture();
  const result = deferred<void>();
  const h = harness(t, {
    grants: [grant()],
    outcomeJournal: j.journal,
    execute: async () => {
      await result.promise;
      return resultProposal();
    },
  });
  await h.worker.start();
  h.timers.advanceTo(0);
  await flush();
  await h.worker.stop();
  assert.equal(j.rows.size, 1);
  result.resolve();
  await flush();
  assert.equal(j.rows.size, 2);
  assert.equal(
    h.requests.some((r) => r.body.type === 'result.proposed'),
    false,
  );
  await assert.rejects(h.contexts[0]!.runStep(async () => undefined));
});

test('journal failure denies result HTTP and exposes unavailable durable receipt while preserving local stop evidence', async (t) => {
  const j = await journalFixture();
  const h = harness(t, {
    grants: [grant()],
    outcomeJournal: j.journal,
    execute: async () => {
      j.failStorage();
      return resultProposal();
    },
  });
  await h.worker.start();
  h.timers.advanceTo(0);
  await flush();
  const stopped = await h.worker.stop();
  assert.equal(stopped[0]!.durableReceipt, 'UNAVAILABLE');
  assert.equal(stopped[0]!.evidence.state, 'TERMINATED');
  assert.equal(
    h.requests.some((r) => r.body.type === 'result.proposed'),
    false,
  );
  assert.equal(j.journal.readyForWork, false);
});

test('journal lifetime capacity prevents a second claim without evicting outcome/stop records', async (t) => {
  const j = await journalFixture(1);
  const h = harness(t, {
    grants: [grant(), grant()],
    outcomeJournal: j.journal,
    execute: async () => resultProposal(),
  });
  await h.worker.start();
  h.timers.advanceTo(0);
  await flush();
  h.timers.advanceTo(1000);
  await flush();
  assert.equal(h.launches, 1);
  assert.equal(h.requests.filter((r) => r.path.endsWith('/claim')).length, 1);
  assert.equal(j.rows.size, 2);
});

test('lease loss records stop evidence even when runtime never returns, without releasing its capacity', async (t) => {
  const j = await journalFixture();
  let activations = 0;
  const h = harness(t, {
    grants: [grant(), grant()],
    outcomeJournal: j.journal,
    lease: async () =>
      ++activations === 1
        ? Response.json({
            state: 'ACTIVE',
            leaseTtlMs: 15000,
            renewIntervalMs: 5000,
          })
        : new Response(null, { status: 409 }),
    execute: async () => new Promise<void>(() => undefined),
  });
  await h.worker.start();
  h.timers.advanceTo(0);
  await flush();
  h.timers.advanceTo(5000);
  await flush();
  assert.equal(h.contexts[0]!.signal.aborted, true);
  assert.equal(j.rows.size, 1);
  const record = await j.journal.read(j.journal.ids()[0]!);
  assert.ok(record.type === 'local.stop');
  assert.equal(record.evidence.state, 'TERMINATED');
  h.timers.advanceTo(6000);
  await flush();
  assert.equal(h.launches, 1);
});

test('worker persists failed evidence, blocks spend on all assignments and allows explicit replay after stop', async (t) => {
  const rows = new Map<string, Uint8Array>();
  let available = false;
  let sends = 0;
  const collector = await RunnerEvidenceCollector.open({
    runnerId: 'worker-one',
    ownerSubject: 'owner-one',
    cipher: fixtureCipher(new Uint8Array(32).fill(7)),
    spool: {
      ids: () => [...rows.keys()],
      read: (id) => Uint8Array.from(rows.get(id)!),
      put: (id, bytes) => {
        rows.set(id, Uint8Array.from(bytes));
      },
      remove: (id) => {
        rows.delete(id);
      },
    },
    http: {
      origin: 'https://runner-api.example',
      timeoutMs: 100,
      bearerToken: async () => 'fixture-token',
      fetchImpl: async () => {
        sends++;
        assert.equal(rows.size, 1);
        if (!available) {
          throw new Error('lost ACK');
        }
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
  const first = grant();
  const second = grant();
  const h = harness(t, {
    grants: [first, second],
    capacity: 2,
    evidenceCollector: collector,
    execute: async () => new Promise<void>(() => undefined),
  });
  await h.worker.start();
  h.timers.advanceTo(0);
  await flush();
  h.timers.advanceTo(1000);
  await flush();
  assert.equal(h.contexts.length, 2);
  await assert.rejects(h.contexts[0]!.reportEvidence(usage(first)));
  assert.equal(rows.size, 1);
  let paid = 0;
  await assert.rejects(
    h.contexts[1]!.runStep(async () => {
      paid++;
    }),
  );
  assert.equal(paid, 0);
  await h.worker.stop();
  available = true;
  assert.equal(await collector.flush(), 1);
  assert.equal(sends, 2);
  assert.equal(rows.size, 0);
  // Replay changes evidence delivery only. Stopped contexts cannot reopen work.
  await assert.rejects(
    h.contexts[1]!.runStep(async () => {
      paid++;
    }),
  );
  assert.equal(paid, 0);
});

test('unacknowledged usage evidence prevents another paid dispatch', async (t) => {
  const pending = deferred<Response>();
  const value = grant();
  let paid = 0;
  let evidence: Promise<unknown> | undefined;
  const h = harness(t, {
    grants: [value],
    reporting: async () => pending.promise,
    execute: async (_grant, context) => {
      evidence = context.reportEvidence(usage(value));
      await assert.rejects(
        context.runStep(async () => {
          paid++;
        }),
      );
      await evidence;
    },
  });
  await h.worker.start();
  h.timers.advanceTo(0);
  await flush();
  assert.equal(paid, 0);
  pending.resolve(
    Response.json(
      { id: randomUUID(), state: 'QUARANTINED', replayed: false, stale: false },
      { status: 202 },
    ),
  );
  await evidence;
  await flush();
});

const resultProposal = (): RunnerResultProposal => ({
  outcome: 'completed',
  digest: 'a'.repeat(64),
  artifactIds: [],
  summary: 'fixture result',
});
function usage(value: RunnerDispatchGrant): UsageCommand {
  return {
    executionId: value.executionId,
    attemptId: value.attemptId,
    sourceEventId: 'fixture-call',
    sourceRevision: 1,
    coverage: ['fixture-call'],
    cumulativeUnits: null,
    completeness: 'unknown',
    costBasis: 'unknown',
    reason: 'unknown remote usage',
  };
}

test('runtime result is proposed once under retained lease and never implies local finalization', async (t) => {
  const value = grant();
  const h = harness(t, {
    grants: [value, value],
    execute: async () => resultProposal(),
  });
  await h.worker.start();
  h.timers.advanceTo(0);
  await flush();
  const reports = h.requests.filter((r) => r.path.endsWith('/reports'));
  assert.equal(reports.length, 2);
  assert.equal(reports[1]!.body.type, 'result.proposed');
  assert.deepEqual(reports[1]!.body.proposal, resultProposal());
  assert.deepEqual(reports[1]!.body.lease, reports[0]!.body.lease);
  assert.equal(h.stops, 1);
  h.timers.advanceTo(1_000);
  await flush();
  assert.equal(
    h.requests.filter((r) => r.body.type === 'result.proposed').length,
    1,
  );
});

test('durable cancel before the next provider step is checked before scheduled renewal', async (t) => {
  const value = grant();
  let cancelled = false;
  let paidCalls = 0;
  let preflights = 0;
  const h = harness(t, {
    grants: [value],
    delivery: undefined,
    reporting: undefined,
    lease: async () => {
      preflights++;
      return cancelled
        ? new Response(null, { status: 409 })
        : Response.json({
            state: 'ACTIVE',
            leaseTtlMs: 15_000,
            renewIntervalMs: 5_000,
          });
    },
    execute: async (_grant, context) => {
      cancelled = true;
      await context.runStep(async () => {
        paidCalls++;
      });
      return resultProposal();
    },
  });
  await h.worker.start();
  h.timers.advanceTo(0);
  await flush();
  assert.equal(preflights, 2);
  assert.equal(paidCalls, 0);
  assert.equal(h.stops, 1);
  assert.equal(
    h.requests.some((r) => r.body.type === 'result.proposed'),
    false,
  );
});

test('periodic durable cancel rejection aborts an in-flight step but preserves late usage intake', async (t) => {
  const value = grant();
  const pending = deferred<void>();
  let cancelled = false;
  let stepSignal: AbortSignal | undefined;
  let receipt = false;
  const h = harness(t, {
    grants: [value],
    lease: async () =>
      cancelled
        ? new Response(null, { status: 409 })
        : Response.json({
            state: 'ACTIVE',
            leaseTtlMs: 15_000,
            renewIntervalMs: 5_000,
          }),
    execute: async (_grant, context) => {
      await context.runStep(async (signal) => {
        stepSignal = signal;
        await pending.promise;
      });
      receipt =
        (await context.reportEvidence(usage(value))).state === 'QUARANTINED';
      return resultProposal();
    },
  });
  await h.worker.start();
  h.timers.advanceTo(0);
  await flush();
  assert.ok(stepSignal);
  cancelled = true;
  h.timers.advanceTo(5_000);
  await flush();
  assert.equal(stepSignal.aborted, true);
  pending.resolve();
  await flush();
  assert.equal(receipt, true);
  assert.equal(
    h.requests.some((r) => r.body.type === 'result.proposed'),
    false,
  );
  assert.equal(
    h.requests.filter((r) => r.path.endsWith('/evidence')).length,
    1,
  );
});

test('late evidence after worker stop keeps old assignment and unknown cost without live lease', async (t) => {
  const value = grant();
  const h = harness(t, { grants: [value] });
  await h.worker.start();
  h.timers.advanceTo(0);
  await flush();
  const context = h.contexts[0]!;
  await h.worker.stop();
  const evidence = usage(value);
  const receipt = await context.reportEvidence(evidence);
  assert.equal(receipt.state, 'QUARANTINED');
  const body = h.requests.find((r) => r.path.endsWith('/evidence'))!.body;
  assert.deepEqual(body.evidence, evidence);
  assert.equal('lease' in body, false);
  assert.equal(
    (body.token as Record<string, unknown>).assignmentId,
    value.assignmentId,
  );
  let paid = 0;
  await assert.rejects(
    context.runStep(async () => {
      paid++;
    }),
  );
  assert.equal(paid, 0);
});

test('evidence failure stops new paid work and explicit same-event replay remains possible', async (t) => {
  const value = grant();
  let calls = 0;
  let paid = 0;
  let replayed = false;
  const id = randomUUID();
  const h = harness(t, {
    grants: [value],
    reporting: async (input) => {
      assert.ok(new URL(String(input)).pathname.endsWith('/evidence'));
      calls++;
      if (calls === 1) {
        throw new Error('lost acknowledgement');
      }
      return Response.json(
        { id, state: 'QUARANTINED', replayed: true, stale: true },
        { status: 202 },
      );
    },
    execute: async (_grant, context) => {
      await assert.rejects(context.reportEvidence(usage(value)));
      await assert.rejects(
        context.runStep(async () => {
          paid++;
        }),
      );
      replayed = (await context.reportEvidence(usage(value))).replayed;
    },
  });
  await h.worker.start();
  h.timers.advanceTo(0);
  await flush();
  assert.equal(calls, 2);
  assert.equal(paid, 0);
  assert.equal(replayed, true);
  const messages = h.requests.filter((r) => r.path.endsWith('/evidence'));
  assert.deepEqual(messages[0]!.body, messages[1]!.body);
});

test('runtime return seals retained provider context while result acknowledgement is pending', async (t) => {
  const ack = deferred<Response>();
  let proposals = 0;
  const h = harness(t, {
    grants: [grant()],
    reporting: async () => {
      proposals++;
      return ack.promise;
    },
    execute: async () => resultProposal(),
  });
  await h.worker.start();
  h.timers.advanceTo(0);
  await flush();
  assert.equal(proposals, 1);
  let paid = 0;
  await assert.rejects(
    h.contexts[0]!.runStep(async () => {
      paid++;
    }),
  );
  assert.equal(paid, 0);
  await h.worker.stop();
  ack.resolve(new Response(null, { status: 409 }));
  await flush();
  assert.equal(proposals, 1);
});

test('a runtime returning with unawaited provider work cannot propose a result', async (t) => {
  const pending = deferred<void>();
  let step: Promise<void> | undefined;
  const h = harness(t, {
    grants: [grant()],
    execute: async (_grant, context) => {
      step = context.runStep(() => pending.promise);
      void step.catch(() => undefined);
      return resultProposal();
    },
  });
  await h.worker.start();
  h.timers.advanceTo(0);
  await flush();
  pending.resolve();
  await assert.rejects(step!);
  assert.equal(
    h.requests.some((r) => r.body.type === 'result.proposed'),
    false,
  );
  assert.equal(h.stops, 1);
});

test('ambiguous result acknowledgement is sent once and never restarts the runtime', async (t) => {
  let proposals = 0;
  let executes = 0;
  const value = grant();
  const h = harness(t, {
    grants: [value, value],
    reporting: async () => {
      proposals++;
      throw new Error('lost proposal acknowledgement');
    },
    execute: async () => {
      executes++;
      return resultProposal();
    },
  });
  await h.worker.start();
  h.timers.advanceTo(0);
  await flush();
  h.timers.advanceTo(1_000);
  await flush();
  assert.equal(proposals, 1);
  assert.equal(executes, 1);
  assert.equal(h.stops, 1);
});

test('evidence concurrency is bounded after stop and overflow cannot enable paid work', async (t) => {
  const value = grant();
  const pending = deferred<Response>();
  const h = harness(t, {
    grants: [value],
    reporting: async () => (await pending.promise).clone(),
  });
  await h.worker.start();
  h.timers.advanceTo(0);
  await flush();
  const context = h.contexts[0]!;
  await h.worker.stop();
  const evidence = usage(value);
  const active = Array.from({ length: 8 }, () =>
    context.reportEvidence(evidence),
  );
  await assert.rejects(context.reportEvidence(evidence));
  pending.resolve(
    Response.json(
      { id: randomUUID(), state: 'QUARANTINED', replayed: true, stale: true },
      { status: 202 },
    ),
  );
  const receipts = await Promise.all(active);
  assert.equal(
    receipts.every((r) => r.state === 'QUARANTINED'),
    true,
  );
  assert.equal(
    h.requests.filter((r) => r.path.endsWith('/evidence')).length,
    8,
  );
  await assert.rejects(context.runStep(async () => undefined));
});

function payloadResponse(bytes: Uint8Array) {
  return new Response(new Uint8Array(bytes), {
    headers: {
      'content-type': 'application/octet-stream',
      'cache-control': 'no-store',
      'content-length': String(bytes.length),
    },
  });
}

function pluginFixture(value: RunnerDispatchGrant) {
  const content = Buffer.from('fixture instructions');
  const bytes = Buffer.from(
    JSON.stringify({
      format: 'ai-runtime-plugin/v1',
      packageId: 'draft',
      version: '1',
      compatibleRuntimeVersions: ['claude:1'],
      requiredPermissions: ['artifact:write'],
      files: [
        {
          path: 'instructions.md',
          sha256: createHash('sha256').update(content).digest('hex'),
          contentBase64: content.toString('base64'),
        },
      ],
    }),
  );
  value.plugin = {
    packageId: 'draft',
    version: '1',
    bundleDigest: createHash('sha256').update(bytes).digest('hex'),
    runtimeVersion: 'claude:1',
    requiredPermissions: ['artifact:write'],
  };
  return bytes;
}

test('lease expiry during payload delivery denies callback even before watchdog fires', async (t) => {
  let callbacks = 0;
  const h = harness(t, {
    grants: [grant()],
    delivery: async () => {
      h.timers.now = 15_000;
      return payloadResponse(new Uint8Array(10));
    },
    execute: async (_grant, context) => {
      await context.withInputs(async () => {
        callbacks++;
      });
    },
  });
  await h.worker.start();
  h.timers.advanceTo(0);
  await flush();
  assert.equal(callbacks, 0);
  assert.equal(h.stops, 1);
});

test('bad plugin bytes close the assignment without handing payload to runtime', async (t) => {
  const value = grant();
  pluginFixture(value);
  let callbacks = 0;
  const h = harness(t, {
    grants: [value],
    delivery: async (input) =>
      payloadResponse(
        new URL(String(input)).pathname.endsWith('/payload')
          ? new Uint8Array(10)
          : Buffer.from('tampered'),
      ),
    execute: async (_grant, context) => {
      await context.withInputs(async () => {
        callbacks++;
      });
    },
  });
  await h.worker.start();
  h.timers.advanceTo(0);
  await flush();
  assert.equal(h.requests.filter((r) => r.path.endsWith('/plugin')).length, 1);
  assert.equal(callbacks, 0);
  assert.equal(h.stops, 1);
});

test('concurrent input requests stop the first handoff without a second download', async (t) => {
  let signal: AbortSignal | undefined;
  let callbacks = 0;
  const h = harness(t, {
    grants: [grant()],
    delivery: async (_input, init) => {
      signal = init?.signal ?? undefined;
      return new Promise(() => undefined);
    },
    execute: async (_grant, context) => {
      const first = context.withInputs(async () => {
        callbacks++;
      });
      await assert.rejects(
        context.withInputs(async () => {
          callbacks++;
        }),
      );
      await assert.rejects(first);
    },
  });
  await h.worker.start();
  h.timers.advanceTo(0);
  await flush();
  assert.equal(callbacks, 0);
  assert.ok(!signal || signal.aborted);
  assert.ok(h.requests.filter((r) => r.path.endsWith('/payload')).length <= 1);
  assert.equal(h.stops, 1);
});

test('worker hands off scoped payload once after STARTED and erases input after callback', async (t) => {
  const value = grant();
  const payload = Buffer.from('private payload');
  value.plaintextBytes = payload.length;
  let retained: Uint8Array | undefined;
  let calls = 0;
  let result = 0;
  const h = harness(t, {
    grants: [value, value],
    delivery: async (_input, init) => {
      calls++;
      const body = JSON.parse(String(init?.body));
      assert.equal(body.envelopeId, value.envelopeId);
      assert.equal(body.bootId, h.worker.identity.bootId);
      const activation = h.requests.find((r) => r.path.endsWith('/activate'))!;
      assert.deepEqual(body, {
        ...activation.body,
        envelopeId: value.envelopeId,
      });
      return payloadResponse(payload);
    },
    execute: async (_grant, context) => {
      result = await context.withInputs(async (inputs, signal) => {
        retained = inputs.payload;
        assert.equal(signal.aborted, false);
        assert.equal(inputs.plugin, null);
        assert.equal(Buffer.from(inputs.payload).toString(), 'private payload');
        return 42;
      });
      await assert.rejects(
        context.withInputs(async () => {
          throw new Error('must never dispatch twice');
        }),
      );
    },
  });
  await h.worker.start();
  h.timers.advanceTo(0);
  await flush();
  assert.equal(result, 42);
  assert.equal(calls, 1);
  assert.ok(retained?.every((x) => x === 0));
  assert.ok(h.events.indexOf('reports') < h.events.indexOf('payload'));
  h.timers.advanceTo(1_000);
  await flush();
  assert.equal(calls, 1);
});

test('stopped worker denies retained input context without starting a download', async (t) => {
  const h = harness(t, { grants: [grant()] });
  await h.worker.start();
  h.timers.advanceTo(0);
  await flush();
  const context = h.contexts[0]!;
  await h.worker.stop();
  await assert.rejects(context.withInputs(async () => undefined));
  assert.equal(h.requests.filter((r) => r.path.endsWith('/payload')).length, 0);
});

test('shutdown during payload download aborts handoff before trusted callback', async (t) => {
  let release!: (response: Response) => void;
  let callback = 0;
  let signal: AbortSignal | undefined;
  const h = harness(t, {
    grants: [grant()],
    delivery: async (_input, init) => {
      signal = init?.signal ?? undefined;
      return new Promise((resolve) => {
        release = resolve;
      });
    },
    execute: async (_grant, context) => {
      await context.withInputs(async () => {
        callback++;
      });
    },
  });
  await h.worker.start();
  h.timers.advanceTo(0);
  await flush();
  assert.ok(signal);
  await h.worker.stop();
  assert.equal(signal.aborted, true);
  release(payloadResponse(new Uint8Array(10)));
  await flush();
  assert.equal(callback, 0);
});

test('shutdown erases borrowed payload while preserving eventual callback evidence', async (t) => {
  const pending = deferred<number>();
  let retained: Uint8Array | undefined;
  let result: number | undefined;
  const h = harness(t, {
    grants: [grant()],
    delivery: async () => payloadResponse(new Uint8Array(10).fill(9)),
    execute: async (_grant, context) => {
      result = await context.withInputs(async (inputs) => {
        retained = inputs.payload;
        return pending.promise;
      });
    },
  });
  await h.worker.start();
  h.timers.advanceTo(0);
  await flush();
  assert.equal(retained?.[0], 9);
  await h.worker.stop();
  assert.ok(retained?.every((x) => x === 0));
  pending.resolve(73);
  await flush();
  assert.equal(result, 73);
});

test('invalid payload seals assignment before runtime can dispatch another protected step', async (t) => {
  let callback = 0;
  let dispatched = 0;
  const h = harness(t, {
    grants: [grant()],
    delivery: async () => payloadResponse(new Uint8Array(11)),
    execute: async (_grant, context) => {
      await assert.rejects(
        context.withInputs(async () => {
          callback++;
        }),
      );
      await assert.rejects(
        context.runStep(async () => {
          dispatched++;
        }),
      );
    },
  });
  await h.worker.start();
  h.timers.advanceTo(0);
  await flush();
  assert.equal(h.requests.filter((r) => r.path.endsWith('/payload')).length, 1);
  assert.equal(callback, 0);
  assert.equal(dispatched, 0);
  assert.equal(h.stops, 1);
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test('worker close stops assignments before closing host once; bounded stop does not release host ownership', async (t) => {
  const barrier = deferred<void>();
  const calls: boolean[] = [];
  const h = harness(t, {
    grants: [grant()],
    sandboxLifecycle: {
      async close(options) {
        calls.push(options?.retainLock === true);
        assert.equal(h.stops, 1);
        await barrier.promise;
      },
    },
  });
  await h.worker.start();
  h.timers.advanceTo(0);
  await flush();
  const closed = h.worker.close(0);
  assert.equal(h.worker.close(10_000), closed);
  const stopped = await h.worker.stop();
  assert.equal(stopped[0]!.evidence.state, 'TERMINATED');
  await flush();
  assert.deepEqual(calls, [false]);
  let settled = false;
  void closed.then(() => {
    settled = true;
  });
  await flush();
  assert.equal(settled, false);
  barrier.resolve();
  assert.equal((await closed).ownership, 'RELEASED');
  assert.equal(h.timers.pending, 0);
  await assert.rejects(h.worker.start());
});

test('host close failure preserves assignment evidence and cannot be retried into an ownership release', async (t) => {
  let closes = 0;
  const h = harness(t, {
    grants: [grant()],
    sandboxLifecycle: {
      async close() {
        closes++;
        throw new Error('LOST original monitor');
      },
    },
  });
  await h.worker.start();
  h.timers.advanceTo(0);
  await flush();
  const result = await h.worker.close();
  assert.equal(result.ownership, 'UNCONFIRMED');
  assert.equal(result.assignments[0]!.evidence.state, 'TERMINATED');
  assert.equal(await h.worker.close(), result);
  assert.equal(closes, 1);
});

test('unknown assignment stop and failed durable stop receipt explicitly retain the host lock', async (t) => {
  for (const mode of ['unknown', 'journal']) {
    const j = await journalFixture();
    const retained: boolean[] = [];
    const h = harness(t, {
      grants: [grant()],
      outcomeJournal: mode === 'journal' ? j.journal : undefined,
      inspect: mode === 'unknown' ? async () => 'UNKNOWN' : undefined,
      sandboxLifecycle: {
        async close(options) {
          retained.push(options?.retainLock === true);
        },
      },
    });
    await h.worker.start();
    h.timers.advanceTo(0);
    await flush();
    if (mode === 'journal') {
      j.failStorage();
    }
    const result = await h.worker.close();
    assert.deepEqual(retained, [true]);
    assert.equal(result.ownership, 'UNCONFIRMED');
    if (mode === 'unknown') {
      assert.equal(result.assignments[0]!.evidence.state, 'UNCONFIRMED');
    } else {
      assert.equal(result.assignments[0]!.durableReceipt, 'UNAVAILABLE');
    }
  }
});

test('shutdown signal and fatal heartbeat failure also close the owned host', async (t) => {
  for (const mode of ['signal', 'heartbeat']) {
    const controller = new AbortController();
    let closes = 0;
    let hearts = 0;
    const h = harness(t, {
      shutdownSignal: controller.signal,
      drainGraceMs: 0,
      sandboxLifecycle: {
        async close() {
          closes++;
        },
      },
      fetchImpl:
        mode === 'heartbeat'
          ? async (_input, init) => {
              if (++hearts > 1) {
                return new Response(null, { status: 409 });
              }
              return Response.json({
                ...JSON.parse(String(init?.body)),
                state: 'ALIVE',
                heartbeatIntervalMs: 5000,
                presenceTtlMs: 15000,
              });
            }
          : undefined,
    });
    await h.worker.start();
    if (mode === 'signal') {
      controller.abort();
    } else {
      h.timers.advanceTo(5000);
    }
    await flush();
    assert.equal(closes, 1);
    assert.equal((await h.worker.close()).ownership, 'RELEASED');
    assert.equal(h.timers.pending, 0);
  }
});

test('stopped worker without a transferred host never claims ownership release', async (t) => {
  const h = harness(t);
  assert.equal((await h.worker.close()).ownership, 'UNMANAGED');
});

test('lease expiry, renewal fence and worker quiesce during bundle preparation all deny the final runsc dispatch', async (t) => {
  for (const mode of ['expiry', 'fence', 'quiesce']) {
    const preparation = deferred<void>();
    let prepared: RunscLaunchRecord | null = null;
    let starts = 0;
    let activations = 0;
    let retained = false;
    const driver = new RunscSandboxDriver({
      async reserve(identity, sandboxId) {
        prepared = {
          identity,
          sandboxId,
          bundle: `/private/bundles/${sandboxId}`,
        };
        await preparation.promise;
        return { record: prepared, fresh: true };
      },
      async lookup() {
        return prepared;
      },
      start() {
        starts++;
        throw new Error('Must not dispatch after authority loss');
      },
      async state() {
        return null;
      },
      async signalAll() {},
      async destroy() {},
      async cgroupEmpty() {
        return true;
      },
    });
    const h = harness(t, {
      grants: [grant()],
      driver,
      sandboxLifecycle: {
        async close(options) {
          retained = options?.retainLock === true;
        },
      },
      lease: async () =>
        ++activations === 1
          ? Response.json({
              state: 'ACTIVE',
              leaseTtlMs: 15000,
              renewIntervalMs: 5000,
            })
          : new Response(null, { status: 409 }),
    });
    await h.worker.start();
    h.timers.advanceTo(0);
    await flush();
    assert.ok(prepared);
    if (mode === 'expiry') {
      h.timers.now = 15000;
    } else if (mode === 'fence') {
      h.timers.advanceTo(5000);
      await flush();
    } else {
      h.worker.quiesce();
    }
    preparation.resolve();
    await flush();
    const result = await h.worker.close();
    assert.equal(starts, 0, mode);
    assert.equal(h.contexts.length, 0);
    assert.equal(
      h.requests.some((request) => request.body.type === 'result.proposed'),
      false,
    );
    assert.equal(result.assignments[0]!.evidence.state, 'UNCONFIRMED');
    assert.equal(result.ownership, 'UNCONFIRMED');
    assert.equal(retained, true);
  }
});

class Timers implements LeaseTimerPort {
  now = 0;
  private next = 0;
  private tasks = new Map<number, { at: number; callback: () => void }>();
  schedule(callback: () => void, delayMs: number): number {
    const id = ++this.next;
    this.tasks.set(id, { at: this.now + delayMs, callback });
    return id;
  }
  cancel(handle: unknown): void {
    this.tasks.delete(handle as number);
  }
  advanceTo(now: number): void {
    this.now = now;
    for (let n = 0; n < 100; n++) {
      const due = [...this.tasks.entries()]
        .filter(([, t]) => t.at <= now)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) {
        return;
      }
      this.tasks.delete(due[0]);
      due[1].callback();
    }
    throw new Error('Timers did not settle.');
  }
  get pending(): number {
    return this.tasks.size;
  }
}

function grant(): RunnerDispatchGrant {
  return {
    assignmentId: randomUUID(),
    executionId: randomUUID(),
    attemptId: randomUUID(),
    runnerId: 'worker-one',
    ownerSubject: 'owner-one',
    generation: 1,
    epoch: 2,
    state: 'GRANTED',
    protocolVersion: '1',
    envelopeId: randomUUID(),
    inputDigest: 'a'.repeat(64),
    plaintextBytes: 10,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    plugin: null,
  };
}

function harness(
  t: TestContext,
  options: {
    grants?: RunnerDispatchGrant[];
    capacity?: number;
    maxTracked?: number;
    fetchImpl?: typeof fetch;
    delivery?: typeof fetch;
    reporting?: typeof fetch;
    lease?: typeof fetch;
    execute?: (
      grant: RunnerDispatchGrant,
      context: RunnerStepContext,
    ) => Promise<void | RunnerResultProposal>;
    launch?: () => Promise<void>;
    inspect?: () => Promise<'EXITED' | 'RUNNING' | 'UNKNOWN'>;
    timers?: LeaseTimerPort;
    shutdownSignal?: AbortSignal;
    drainGraceMs?: number;
    evidenceCollector?: RunnerEvidenceCollector;
    outcomeJournal?: RunnerOutcomeJournal;
    sandboxLifecycle?: RunnerWorkerOptions['sandboxLifecycle'];
    driver?: SandboxDriver;
  } = {},
) {
  const timers = new Timers();
  const events: string[] = [];
  const requests: { path: string; body: Record<string, unknown> }[] = [];
  const contexts: RunnerStepContext[] = [];
  const grants = [...(options.grants ?? [])];
  let launches = 0;
  let stops = 0;
  const worker = new RunnerWorker({
    runnerId: 'worker-one',
    ownerSubject: 'owner-one',
    registrationRevision: 3,
    capacity: options.capacity ?? 1,
    maxTracked: options.maxTracked ?? 256,
    pollIntervalMs: 1_000,
    shutdownSignal: options.shutdownSignal,
    drainGraceMs: options.drainGraceMs,
    evidenceCollector: options.evidenceCollector,
    outcomeJournal: options.outcomeJournal,
    sandboxLifecycle: options.sandboxLifecycle,
    clock: { nowMs: () => timers.now },
    timers: options.timers ?? timers,
    http: {
      origin: 'https://runner-api.example',
      timeoutMs: 1_000,
      bearerToken: async () => 'fixture-token',
      fetchImpl: async (input, init) => {
        const path = new URL(String(input)).pathname;
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        requests.push({ path, body });
        events.push(path.split('/').at(-1)!);
        if (
          options.delivery &&
          (path.endsWith('/payload') || path.endsWith('/plugin'))
        ) {
          return options.delivery(input, init);
        }
        if (options.fetchImpl) {
          return options.fetchImpl(input, init);
        }
        if (options.lease && path.endsWith('/activate')) {
          return options.lease(input, init);
        }
        if (
          options.reporting &&
          (path.endsWith('/evidence') || body.type === 'result.proposed')
        ) {
          return options.reporting(input, init);
        }
        if (path.endsWith('/evidence')) {
          return Response.json(
            {
              id: randomUUID(),
              state: 'QUARANTINED',
              replayed: false,
              stale: false,
            },
            { status: 202 },
          );
        }
        if (path.endsWith('/heartbeat')) {
          return Response.json({
            ...body,
            state: 'ALIVE',
            heartbeatIntervalMs: 5_000,
            presenceTtlMs: 15_000,
          });
        }
        if (path.endsWith('/claim')) {
          return Response.json({ grant: grants.shift() ?? null });
        }
        if (path.endsWith('/activate')) {
          return Response.json({
            state: 'ACTIVE',
            leaseTtlMs: 15_000,
            renewIntervalMs: 5_000,
          });
        }
        return Response.json({
          ...(body.token as object),
          ownerSubject: 'owner-one',
          state:
            body.type === 'result.proposed' ? 'RESULT_PROPOSED' : 'STARTED',
          protocolVersion: '1',
        });
      },
    },
    driver: options.driver ?? {
      async launch() {
        launches++;
        events.push('launch');
        await options.launch?.();
        let exited = false;
        return {
          async requestStop() {
            stops++;
            exited = true;
            events.push('stop');
          },
          async forceStop() {
            exited = true;
          },
          inspect:
            options.inspect ?? (async () => (exited ? 'EXITED' : 'RUNNING')),
        };
      },
      async recover() {
        return null;
      },
    },
    runtime: {
      async execute(value, context) {
        contexts.push(context);
        events.push('execute');
        if (options.execute) {
          return options.execute(value, context);
        }
        await new Promise<void>((resolve) => {
          if (context.signal.aborted) {
            resolve();
          } else {
            context.signal.addEventListener('abort', () => resolve(), {
              once: true,
            });
          }
        });
      },
    },
  });
  t.after(async () => {
    await worker.stop();
  });
  return {
    worker,
    timers,
    requests,
    events,
    contexts,
    get launches() {
      return launches;
    },
    get stops() {
      return stops;
    },
  };
}

test('bootstrap heartbeats before claim, reports exact STARTED before trusted work and keeps one boot', async (t) => {
  const h = harness(t, { grants: [grant()] });
  const starting = h.worker.start();
  assert.equal(h.worker.start(), starting);
  await starting;
  assert.deepEqual(h.events, ['heartbeat']);
  h.timers.advanceTo(0);
  await flush();
  assert.deepEqual(h.events, [
    'heartbeat',
    'claim',
    'activate',
    'launch',
    'reports',
    'execute',
  ]);
  const lease = h.requests.find((r) => r.path.endsWith('/activate'))!.body;
  const report = h.requests.find((r) => r.path.endsWith('/reports'))!.body;
  assert.deepEqual(report.lease, {
    bootId: h.worker.identity.bootId,
    registrationRevision: 3,
    nonce: lease.nonce,
  });
  assert.deepEqual(report.token, lease.token);
  assert.equal(await h.contexts[0]!.runStep(async () => 'receipt'), 'receipt');
  h.timers.advanceTo(5_000);
  await flush();
  const hearts = h.requests.filter((r) => r.path.endsWith('/heartbeat'));
  assert.equal(hearts.length, 2);
  assert.deepEqual(hearts[0]!.body, hearts[1]!.body);
  assert.equal(h.launches, 1);
  assert.equal(
    h.requests.filter((r) => r.path.endsWith('/claim')).length,
    1,
    'capacity includes running assignments',
  );
  const stopped = await h.worker.stop();
  assert.equal(stopped[0]!.evidence.state, 'TERMINATED');
  assert.equal(h.timers.pending, 0);
  assert.equal(h.contexts[0]!.signal.aborted, true);
});

test('duplicate grants retain one lifecycle and nonce even after local completion', async (t) => {
  const value = grant();
  const h = harness(t, {
    grants: [value, value, value],
    execute: async () => {},
  });
  await h.worker.start();
  for (const at of [0, 1_000, 2_000]) {
    h.timers.advanceTo(at);
    await flush();
  }
  assert.equal(h.launches, 1);
  assert.equal(h.stops, 1);
  assert.equal(h.contexts.length, 1);
  assert.equal(
    h.requests.filter((r) => r.path.endsWith('/activate')).length,
    1,
  );
  assert.equal(h.requests.filter((r) => r.path.endsWith('/claim')).length, 3);
});

test('heartbeat progresses during a pending claim and a late claim after quiesce cannot launch', async (t) => {
  const response = deferred<Response>();
  const h = harness(t, {
    fetchImpl: async (input, init) => {
      if (String(input).endsWith('/claim')) {
        return response.promise;
      }
      return Response.json({
        ...JSON.parse(String(init?.body)),
        state: 'ALIVE',
        heartbeatIntervalMs: 5_000,
        presenceTtlMs: 15_000,
      });
    },
  });
  await h.worker.start();
  h.timers.advanceTo(0);
  await flush();
  h.timers.advanceTo(5_000);
  await flush();
  assert.equal(
    h.requests.filter((r) => r.path.endsWith('/heartbeat')).length,
    2,
  );
  assert.equal(h.requests.filter((r) => r.path.endsWith('/claim')).length, 1);
  h.worker.quiesce();
  response.resolve(Response.json({ grant: grant() }));
  await flush();
  assert.equal(h.launches, 0);
  assert.deepEqual(await h.worker.stop(), []);
  assert.equal(h.timers.pending, 0);
});

test('lost claim acknowledgement is polled again with the same boot without duplicate launch', async (t) => {
  const value = grant();
  let claims = 0;
  const h = harness(t, {
    fetchImpl: async (input, init) => {
      const body = JSON.parse(String(init?.body));
      if (String(input).endsWith('/heartbeat')) {
        return Response.json({
          ...body,
          state: 'ALIVE',
          heartbeatIntervalMs: 5_000,
          presenceTtlMs: 15_000,
        });
      }
      if (String(input).endsWith('/claim')) {
        if (++claims === 1) {
          throw new Error('ack lost after durable grant');
        }
        return Response.json({ grant: value });
      }
      if (String(input).endsWith('/activate')) {
        return Response.json({
          state: 'ACTIVE',
          leaseTtlMs: 15_000,
          renewIntervalMs: 5_000,
        });
      }
      return Response.json({
        ...body.token,
        ownerSubject: 'owner-one',
        state: 'STARTED',
        protocolVersion: '1',
      });
    },
  });
  await h.worker.start();
  h.timers.advanceTo(0);
  await flush();
  assert.equal(h.launches, 0);
  h.timers.advanceTo(1_000);
  await flush();
  assert.equal(h.launches, 1);
  const polls = h.requests.filter((r) => r.path.endsWith('/claim'));
  assert.equal(polls.length, 2);
  assert.deepEqual(polls[0]!.body, polls[1]!.body);
});

test('heartbeat rejection stops existing assignments and permanently seals this worker', async (t) => {
  const value = grant();
  let hearts = 0;
  const h = harness(t, {
    fetchImpl: async (input, init) => {
      const body = JSON.parse(String(init?.body));
      if (String(input).endsWith('/heartbeat')) {
        return ++hearts === 1
          ? Response.json({
              ...body,
              state: 'ALIVE',
              heartbeatIntervalMs: 5_000,
              presenceTtlMs: 15_000,
            })
          : new Response(null, { status: 503 });
      }
      if (String(input).endsWith('/claim')) {
        return Response.json({ grant: value });
      }
      if (String(input).endsWith('/activate')) {
        return Response.json({
          state: 'ACTIVE',
          leaseTtlMs: 15_000,
          renewIntervalMs: 5_000,
        });
      }
      return Response.json({
        ...body.token,
        ownerSubject: 'owner-one',
        state: 'STARTED',
        protocolVersion: '1',
      });
    },
  });
  await h.worker.start();
  h.timers.advanceTo(0);
  await flush();
  h.timers.advanceTo(5_000);
  await flush();
  await h.worker.stop();
  assert.equal(h.contexts[0]!.signal.aborted, true);
  await assert.rejects(
    h.contexts[0]!.runStep(async () => assert.fail('stale work')),
  );
  await assert.rejects(h.worker.start(), /stopped/i);
  assert.equal(h.stops, 1);
  assert.equal(h.timers.pending, 0);
});

test('quiesce preserves running work and heartbeat until explicit stop', async (t) => {
  const h = harness(t, { grants: [grant()], capacity: 2 });
  await h.worker.start();
  h.timers.advanceTo(0);
  await flush();
  h.worker.quiesce();
  assert.equal(
    await h.contexts[0]!.runStep(async () => 'in-flight'),
    'in-flight',
  );
  h.timers.advanceTo(5_000);
  await flush();
  assert.equal(h.requests.filter((r) => r.path.endsWith('/claim')).length, 1);
  assert.equal(
    h.requests.filter((r) => r.path.endsWith('/heartbeat')).length,
    2,
  );
  assert.equal(h.stops, 0);
});

test('drain deadline stops a sandbox without waiting forever for an uncooperative runtime', async (t) => {
  const h = harness(t, {
    grants: [grant()],
    execute: async () => new Promise<void>(() => {}),
  });
  await h.worker.start();
  h.timers.advanceTo(0);
  await flush();
  const first = h.worker.drain(10);
  assert.equal(
    h.worker.drain(1_000),
    first,
    'duplicate drain cannot extend grace',
  );
  const results = await first;
  assert.equal(results[0]!.evidence.state, 'TERMINATED');
  assert.equal(h.stops, 1);
  assert.equal(h.contexts[0]!.signal.aborted, true);
  assert.equal(h.timers.pending, 0);
});

test('steps check the monotonic drain deadline even before its timer fires', async (t) => {
  const h = harness(t, { grants: [grant()] });
  await h.worker.start();
  h.timers.advanceTo(0);
  await flush();
  const draining = h.worker.drain(100);
  h.timers.now = 100;
  await assert.rejects(
    h.contexts[0]!.runStep(async () => assert.fail('past grace')),
  );
  await draining;
  assert.equal(h.stops, 1);
});

test('quiesce during activation rejects the queued launch', async (t) => {
  const response = deferred<Response>();
  const value = grant();
  const h = harness(t, {
    fetchImpl: async (input, init) => {
      const body = JSON.parse(String(init?.body));
      if (String(input).endsWith('/heartbeat')) {
        return Response.json({
          ...body,
          state: 'ALIVE',
          heartbeatIntervalMs: 5_000,
          presenceTtlMs: 15_000,
        });
      }
      if (String(input).endsWith('/claim')) {
        return Response.json({ grant: value });
      }
      return response.promise;
    },
  });
  await h.worker.start();
  h.timers.advanceTo(0);
  await flush();
  h.worker.quiesce();
  response.resolve(
    Response.json({
      state: 'ACTIVE',
      leaseTtlMs: 15_000,
      renewIntervalMs: 5_000,
    }),
  );
  await flush();
  assert.equal(h.launches, 0);
  assert.equal(h.contexts.length, 0);
});

test('wrong owner or changed duplicate grant fails closed before another runtime is launched', async (t) => {
  const value = grant();
  const h = harness(t, {
    grants: [value, { ...value, inputDigest: 'b'.repeat(64) }],
    capacity: 2,
  });
  await h.worker.start();
  h.timers.advanceTo(0);
  await flush();
  h.timers.advanceTo(1_000);
  await flush();
  await assert.rejects(h.worker.start(), /stopped/i);
  assert.equal(h.contexts.length, 1);
  assert.equal(h.contexts[0]!.signal.aborted, true);
  const wrong = harness(t, {
    grants: [{ ...grant(), ownerSubject: 'other-owner' }],
  });
  await wrong.worker.start();
  wrong.timers.advanceTo(0);
  await flush();
  assert.equal(wrong.launches, 0);
  await assert.rejects(wrong.worker.start(), /stopped/i);
});

test('an ambiguous STARTED report stops local work without executing or retrying the runtime', async (t) => {
  const value = grant();
  const h = harness(t, {
    fetchImpl: async (input, init) => {
      const body = JSON.parse(String(init?.body));
      if (String(input).endsWith('/heartbeat')) {
        return Response.json({
          ...body,
          state: 'ALIVE',
          heartbeatIntervalMs: 5_000,
          presenceTtlMs: 15_000,
        });
      }
      if (String(input).endsWith('/claim')) {
        return Response.json({ grant: value });
      }
      if (String(input).endsWith('/activate')) {
        return Response.json({
          state: 'ACTIVE',
          leaseTtlMs: 15_000,
          renewIntervalMs: 5_000,
        });
      }
      throw new Error('report ack lost');
    },
  });
  await h.worker.start();
  h.timers.advanceTo(0);
  await flush();
  h.timers.advanceTo(1_000);
  await flush();
  assert.equal(h.launches, 1);
  assert.equal(h.stops, 1);
  assert.equal(h.contexts.length, 0);
  assert.equal(h.requests.filter((r) => r.path.endsWith('/reports')).length, 1);
});

test('unconfirmed cleanup retains its capacity slot and tracked identities are never evicted', async (t) => {
  const h = harness(t, {
    grants: [grant(), grant()],
    execute: async () => {},
    inspect: async () => 'UNKNOWN',
  });
  await h.worker.start();
  h.timers.advanceTo(0);
  await flush();
  h.timers.advanceTo(1_000);
  await flush();
  assert.equal(h.requests.filter((r) => r.path.endsWith('/claim')).length, 1);
  const limited = harness(t, {
    grants: [grant(), grant()],
    maxTracked: 1,
    execute: async () => {},
  });
  await limited.worker.start();
  limited.timers.advanceTo(0);
  await flush();
  limited.timers.advanceTo(1_000);
  await flush();
  assert.equal(
    limited.requests.filter((r) => r.path.endsWith('/claim')).length,
    1,
  );
});

test('stop before queued startup avoids HTTP and a new worker receives a new boot', async (t) => {
  const h = harness(t);
  const next = harness(t);
  assert.notEqual(h.worker.identity.bootId, next.worker.identity.bootId);
  const starting = h.worker.start();
  const rejected = assert.rejects(starting, /startup|stopped/i);
  const stopping = h.worker.stop();
  assert.equal(h.worker.stop(), stopping);
  await rejected;
  await stopping;
  assert.equal(h.requests.length, 0);
  assert.equal(h.timers.pending, 0);
});

for (const expiryPoint of ['claim', 'activation'] as const) {
  test(`presence expiry during ${expiryPoint} prevents sandbox launch`, async (t) => {
    const value = grant();
    const h = harness(t, {
      fetchImpl: async (input, init) => {
        const body = JSON.parse(String(init?.body));
        if (String(input).endsWith('/heartbeat')) {
          return Response.json({
            ...body,
            state: 'ALIVE',
            heartbeatIntervalMs: 5_000,
            presenceTtlMs: 15_000,
          });
        }
        if (String(input).endsWith('/claim')) {
          h.timers.now = expiryPoint === 'claim' ? 15_000 : 14_999;
          return Response.json({ grant: value });
        }
        h.timers.now = 15_001;
        return Response.json({
          state: 'ACTIVE',
          leaseTtlMs: 15_000,
          renewIntervalMs: 5_000,
        });
      },
    });
    await h.worker.start();
    h.timers.advanceTo(0);
    await flush();
    assert.equal(h.launches, 0);
    assert.equal(h.contexts.length, 0);
    await assert.rejects(h.worker.start(), /stopped/i);
  });
}

test('a failed claim timer cannot report successful bootstrap', async (t) => {
  const timers = new Timers();
  let scheduled = 0;
  const h = harness(t, {
    timers: {
      schedule(callback, delayMs) {
        if (++scheduled === 2) {
          throw new Error('timer failed');
        }
        return timers.schedule(callback, delayMs);
      },
      cancel: (handle) => timers.cancel(handle),
    },
  });
  await assert.rejects(h.worker.start(), /startup/i);
  assert.equal(timers.pending, 0);
  assert.equal(h.launches, 0);
});

test('capacity counts all assignments including pending startup', async (t) => {
  const h = harness(t, { capacity: 2, grants: [grant(), grant(), grant()] });
  await h.worker.start();
  for (const at of [0, 1_000, 2_000]) {
    h.timers.advanceTo(at);
    await flush();
  }
  assert.equal(h.contexts.length, 2);
  assert.equal(h.requests.filter((r) => r.path.endsWith('/claim')).length, 2);
});

test('a second assignment for a retained execution cannot launch replacement work', async (t) => {
  const value = grant();
  const h = harness(t, {
    capacity: 2,
    grants: [value, { ...value, assignmentId: randomUUID() }],
  });
  await h.worker.start();
  h.timers.advanceTo(0);
  await flush();
  h.timers.advanceTo(1_000);
  await flush();
  assert.equal(h.launches, 1);
  await assert.rejects(h.worker.start(), /stopped/i);
});

test('host shutdown signal drains active work and a pre-aborted signal prevents bootstrap', async (t) => {
  const controller = new AbortController();
  const h = harness(t, {
    grants: [grant()],
    shutdownSignal: controller.signal,
    drainGraceMs: 10,
  });
  await h.worker.start();
  h.timers.advanceTo(0);
  await flush();
  controller.abort();
  assert.equal(h.stops, 0, 'in-flight grace is preserved');
  const results = await h.worker.drain(1_000);
  assert.equal(results[0]!.evidence.state, 'TERMINATED');
  assert.equal(h.stops, 1);
  assert.equal(h.timers.pending, 0);
  const aborted = new AbortController();
  aborted.abort();
  const cold = harness(t, { shutdownSignal: aborted.signal });
  await assert.rejects(cold.worker.start(), /stopped/i);
  assert.equal(cold.requests.length, 0);
});

test(
  'loopback worker hands off inputs, checks authority, reports evidence and proposes result before cleanup',
  { timeout: 5_000 },
  async (t) => {
    const value = grant();
    const payload = Buffer.from('fixture private payload');
    value.plaintextBytes = payload.length;
    const plugin = pluginFixture(value);
    const root = await mkdtemp(join(tmpdir(), 'ai-runtime-handoff-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    let retained:
      { payload: Uint8Array; plugin: Uint8Array | null } | undefined;
    const requests: { path: string; body: Record<string, unknown> }[] = [];
    const failures: unknown[] = [];
    const entered = deferred<void>();
    const finished = deferred<void>();
    const timers = new Timers();
    const server = createServer((request, response) => {
      void (async () => {
        assert.equal(request.method, 'POST');
        assert.equal(request.headers.authorization, 'Bearer fixture-token');
        assert.equal(request.headers['x-runner-protocol'], '1');
        const chunks: Buffer[] = [];
        for await (const chunk of request) {
          chunks.push(Buffer.from(chunk));
        }
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const path = request.url!;
        requests.push({ path, body });
        let result: unknown;
        if (path.endsWith('/heartbeat')) {
          result = {
            ...body,
            state: 'ALIVE',
            heartbeatIntervalMs: 5_000,
            presenceTtlMs: 15_000,
          };
        } else if (path.endsWith('/claim')) {
          result = { grant: value };
        } else if (path.endsWith('/activate')) {
          result = {
            state: 'ACTIVE',
            leaseTtlMs: 15_000,
            renewIntervalMs: 5_000,
          };
        } else if (path.endsWith('/reports')) {
          result = {
            ...body.token,
            ownerSubject: 'owner-one',
            state:
              body.type === 'result.proposed' ? 'RESULT_PROPOSED' : 'STARTED',
            protocolVersion: '1',
          };
        } else if (path.endsWith('/evidence')) {
          assert.deepEqual(body.evidence, usage(value));
          assert.equal('lease' in body, false);
          response.writeHead(202, { 'content-type': 'application/json' });
          response.end(
            JSON.stringify({
              id: randomUUID(),
              state: 'QUARANTINED',
              replayed: false,
              stale: false,
            }),
          );
          return;
        } else if (path.endsWith('/payload') || path.endsWith('/plugin')) {
          assert.deepEqual(body, {
            ...requests.find((r) => r.path.endsWith('/activate'))!.body,
            envelopeId: value.envelopeId,
          });
          assert.equal(request.headers.accept, 'application/octet-stream');
          const bytes = path.endsWith('/payload') ? payload : plugin;
          response.writeHead(200, {
            'content-type': 'application/octet-stream',
            'cache-control': 'no-store',
            'content-length': bytes.length,
          });
          response.end(bytes);
          return;
        } else {
          throw new Error('Unexpected fixture route.');
        }
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify(result));
      })().catch((error: unknown) => {
        failures.push(error);
        response.writeHead(500);
        response.end();
      });
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    let launches = 0;
    let stops = 0;
    const worker = new RunnerWorker({
      runnerId: 'worker-one',
      ownerSubject: 'owner-one',
      registrationRevision: 3,
      capacity: 1,
      clock: { nowMs: () => timers.now },
      timers,
      http: {
        origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
        allowHttpLoopbackForTests: true,
        timeoutMs: 3_000,
        bearerToken: async () => 'fixture-token',
      },
      driver: {
        async launch(identity) {
          launches++;
          assert.equal(identity.bootId, worker.identity.bootId);
          return {
            async requestStop() {
              stops++;
              finished.resolve();
            },
            async forceStop() {},
            async inspect() {
              return stops ? 'EXITED' : 'RUNNING';
            },
          };
        },
        async recover() {
          return null;
        },
      },
      runtime: {
        async execute(received, context) {
          assert.deepEqual(received, value);
          assert.ok(requests.at(-1)!.path.endsWith('/reports'));
          await context.withInputs(async (inputs) => {
            retained = inputs;
            assert.equal(
              Buffer.from(inputs.payload).toString(),
              payload.toString(),
            );
            assert.ok(inputs.plugin);
            const pinned = received.plugin!;
            const materialized = await context.runStep(() =>
              materializePluginBundle(root, inputs.plugin!, {
                packageId: pinned.packageId,
                version: pinned.version,
                digest: pinned.bundleDigest,
                state: 'ACTIVE',
                runtimeVersion: pinned.runtimeVersion,
                allowedPermissions: pinned.requiredPermissions,
              }),
            );
            assert.equal(
              (
                await readFile(join(materialized.directory, 'instructions.md'))
              ).toString(),
              'fixture instructions',
            );
            assert.equal(
              await context.runStep(async () => 'fixture-effect-receipt'),
              'fixture-effect-receipt',
            );
            entered.resolve();
            assert.equal(
              (await context.reportEvidence(usage(value))).state,
              'QUARANTINED',
            );
          });
          return resultProposal();
        },
      },
    });
    t.after(async () => {
      await worker.stop();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });
    await worker.start();
    timers.advanceTo(0);
    await entered.promise;
    await finished.promise;
    assert.deepEqual(
      requests.map((r) => r.path.split('/').at(-1)),
      [
        'heartbeat',
        'claim',
        'activate',
        'reports',
        'payload',
        'plugin',
        'activate',
        'activate',
        'evidence',
        'reports',
      ],
    );
    assert.deepEqual(failures, []);
    assert.equal(launches, 1);
    assert.equal((await worker.drain(10))[0]!.evidence.state, 'TERMINATED');
    assert.equal(stops, 1);
    assert.ok(retained?.payload.every((x) => x === 0));
    assert.ok(retained?.plugin?.every((x) => x === 0));
    assert.equal(timers.pending, 0);
  },
);
