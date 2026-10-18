import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import test, { type TestContext } from 'node:test';
import type { RunnerLeaseCommand } from '@ai-runtime/contracts/http';
import { RunnerAssignmentLifecycle } from '../src/runner-assignment-lifecycle.js';
import type { LeaseTimerPort } from '../src/runner-lease-loop.js';
import {
  LocalSandboxSupervisor,
  type SandboxDriver,
  type SandboxHandle,
  type SandboxIdentity,
} from '../src/sandbox-supervisor.js';

const ack = { state: 'ACTIVE', leaseTtlMs: 15_000, renewIntervalMs: 5_000 };
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

test('step authorization rechecks durable authority without waiting for scheduled renewal', async (t) => {
  let cancelled = false;
  let calls = 0;
  const h = harness(t, {
    fetchImpl: async () => {
      calls++;
      return cancelled
        ? new Response(null, { status: 409 })
        : Response.json(ack);
    },
  });
  await h.lifecycle.start();
  cancelled = true;
  await assert.rejects(h.lifecycle.checkAuthority());
  let dispatches = 0;
  await assert.rejects(
    h.lifecycle.runStep(async () => {
      dispatches++;
    }),
  );
  assert.equal(calls, 2);
  assert.equal(dispatches, 0);
  assert.equal(h.lifecycle.signal.aborted, true);
});

test('cancel during authority preflight prevents a late successful ack reopening the gate', async (t) => {
  const pending = deferred<Response>();
  let calls = 0;
  const h = harness(t, {
    fetchImpl: async () =>
      ++calls === 1 ? Response.json(ack) : pending.promise,
  });
  await h.lifecycle.start();
  const checking = h.lifecycle.checkAuthority();
  await flush();
  await h.lifecycle.stop();
  await assert.rejects(checking);
  pending.resolve(Response.json(ack));
  await flush();
  await assert.rejects(h.lifecycle.runStep(async () => undefined));
  assert.equal(h.stopRequests, 1);
});

test('authority preflight cannot extend an expired local lease when the watchdog is delayed', async (t) => {
  let calls = 0;
  const h = harness(t, {
    fetchImpl: async () => {
      calls++;
      if (calls === 2) {
        h.timers.now = 15_000;
      }
      return Response.json(ack);
    },
  });
  await h.lifecycle.start();
  await assert.rejects(h.lifecycle.checkAuthority());
  assert.equal(h.lifecycle.signal.aborted, true);
  await h.lifecycle.stop();
  assert.equal(h.stopRequests, 1);
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

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
    for (let count = 0; count < 20; count++) {
      const due = [...this.tasks.entries()]
        .filter(([, task]) => task.at <= now)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) {
        return;
      }
      this.tasks.delete(due[0]);
      due[1].callback();
    }
    throw new Error('Timer fixture failed to settle.');
  }

  get pending(): number {
    return this.tasks.size;
  }
}

function command(): RunnerLeaseCommand {
  return {
    bootId: randomUUID(),
    registrationRevision: 3,
    nonce: 'a'.repeat(32),
    token: {
      assignmentId: randomUUID(),
      executionId: randomUUID(),
      attemptId: randomUUID(),
      runnerId: 'runner-one',
      generation: 2,
      epoch: 4,
    },
  };
}

function harness(
  t: TestContext,
  overrides: {
    fetchImpl?: typeof fetch;
    driver?: SandboxDriver;
    timers?: LeaseTimerPort;
    launchTimeoutMs?: number;
  } = {},
) {
  const timers = new Timers();
  const grant = command();
  const events: string[] = [];
  const requests: unknown[] = [];
  const launches: SandboxIdentity[] = [];
  let stopRequests = 0;
  let exited = false;
  const handle: SandboxHandle = {
    async requestStop() {
      events.push('stop');
      stopRequests++;
      exited = true;
    },
    async forceStop() {
      throw new Error('Graceful fixture should exit.');
    },
    async inspect() {
      return exited ? 'EXITED' : 'RUNNING';
    },
  };
  const supervisor = new LocalSandboxSupervisor(
    overrides.driver ?? {
      async launch(identity) {
        events.push('launch');
        launches.push(identity);
        assert.equal(timers.pending, 2, 'renewal and watchdog precede launch');
        return handle;
      },
      async recover() {
        return null;
      },
    },
    { launchMs: 100, gracefulMs: 20, forceMs: 20 },
  );
  const lifecycle = new RunnerAssignmentLifecycle(grant, {
    ownerSubject: 'owner-one',
    supervisor,
    clock: { nowMs: () => timers.now },
    timers: overrides.timers ?? timers,
    launchTimeoutMs: overrides.launchTimeoutMs ?? 100,
    http: {
      origin: 'https://runner-api.example',
      bearerToken: async () => 'fixture-machine-token',
      timeoutMs: 100,
      fetchImpl: async (input, init) => {
        events.push('lease');
        requests.push(JSON.parse(String(init?.body)));
        return overrides.fetchImpl
          ? overrides.fetchImpl(input, init)
          : Response.json(ack);
      },
    },
  });
  t.after(() => lifecycle.stop());
  return {
    lifecycle,
    grant,
    timers,
    events,
    requests,
    launches,
    handle,
    supervisor,
    get stopRequests() {
      return stopRequests;
    },
  };
}

test('one lifecycle binds activation, renewal, guarded work and sandbox cleanup', async (t) => {
  const h = harness(t);
  const captured = structuredClone(h.grant);
  h.grant.token.generation++;
  h.grant.nonce = 'b'.repeat(32);
  const first = h.lifecycle.start();
  assert.equal(h.lifecycle.start(), first);
  await first;
  assert.deepEqual(h.events, ['lease', 'launch']);
  assert.deepEqual(h.launches, [
    { ...captured.token, bootId: captured.bootId, ownerSubject: 'owner-one' },
  ]);
  let stepSignal!: AbortSignal;
  assert.equal(
    await h.lifecycle.runStep(async (signal) => {
      stepSignal = signal;
      return 'provider-receipt';
    }),
    'provider-receipt',
  );
  h.timers.advanceTo(5_000);
  await flush();
  assert.deepEqual(h.requests, [captured, captured]);
  assert.equal(h.launches.length, 1);
  assert.deepEqual(await h.lifecycle.stop(), {
    state: 'TERMINATED',
    method: 'GRACEFUL',
  });
  assert.equal(stepSignal.aborted, true);
  assert.equal(h.stopRequests, 1);
  assert.equal(h.timers.pending, 0);
  h.timers.advanceTo(100_000);
  assert.equal(h.requests.length, 2);
  await assert.rejects(h.lifecycle.start(), /stopped/i);
  await assert.rejects(
    h.lifecycle.runStep(async () => assert.fail('late step')),
  );
  await h.lifecycle.stop();
  assert.equal(h.stopRequests, 1);
});

test('work is refused before startup and while activation is pending', async (t) => {
  const response = deferred<Response>();
  const h = harness(t, { fetchImpl: async () => response.promise });
  await assert.rejects(
    h.lifecycle.runStep(async () => assert.fail('early step')),
  );
  const starting = h.lifecycle.start();
  await flush();
  await assert.rejects(
    h.lifecycle.runStep(async () => assert.fail('pending step')),
  );
  assert.equal(h.launches.length, 0);
  response.resolve(Response.json(ack));
  await starting;
  assert.equal(await h.lifecycle.runStep(async () => 'active'), 'active');
});

test('stop before a queued startup prevents activation and seals the assignment', async (t) => {
  const h = harness(t);
  const starting = h.lifecycle.start();
  const rejected = assert.rejects(starting, /startup|stopped/i);
  assert.deepEqual(await h.lifecycle.stop(), {
    state: 'UNCONFIRMED',
    method: null,
  });
  await rejected;
  assert.equal(h.requests.length, 0);
  assert.equal(h.launches.length, 0);
  assert.equal(h.timers.pending, 0);
});

test('cancel during activation settles startup and a late ack cannot launch work', async (t) => {
  const response = deferred<Response>();
  const h = harness(t, { fetchImpl: async () => response.promise });
  const starting = h.lifecycle.start();
  const rejected = assert.rejects(starting, /startup|stopped/i);
  await flush();
  await h.lifecycle.stop();
  await rejected;
  response.resolve(Response.json(ack));
  await flush();
  assert.equal(h.requests.length, 1);
  assert.equal(h.launches.length, 0);
  assert.equal(h.timers.pending, 0);
});

test('cancel during launch closes startup before a late sandbox is stopped', async (t) => {
  const launched = deferred<SandboxHandle>();
  let launchCalls = 0;
  const h = harness(t, {
    driver: {
      async launch() {
        launchCalls++;
        return launched.promise;
      },
      async recover() {
        return null;
      },
    },
  });
  const starting = h.lifecycle.start();
  const rejected = assert.rejects(starting, /startup|stopped/i);
  await flush();
  assert.equal(launchCalls, 1);
  const stopping = h.lifecycle.stop();
  await rejected;
  await assert.rejects(
    h.lifecycle.runStep(async () => assert.fail('late step')),
  );
  launched.resolve(h.handle);
  assert.equal((await stopping).state, 'TERMINATED');
  assert.equal(h.stopRequests, 1);
  assert.equal(h.timers.pending, 0);
});

test('renewal loss aborts cooperative work before local cleanup and denies new effects', async (t) => {
  let requests = 0;
  const stopped = deferred<void>();
  let stopCalls = 0;
  let signal!: AbortSignal;
  const h = harness(t, {
    fetchImpl: async () =>
      ++requests === 1
        ? Response.json(ack)
        : new Response(null, { status: 409 }),
    driver: {
      async launch() {
        return {
          async requestStop() {
            stopCalls++;
            assert.equal(signal.aborted, true);
            await stopped.promise;
          },
          async forceStop() {},
          async inspect() {
            return 'UNKNOWN';
          },
        };
      },
      async recover() {
        return null;
      },
    },
  });
  await h.lifecycle.start();
  await h.lifecycle.runStep(async (current) => {
    signal = current;
  });
  h.timers.advanceTo(5_000);
  await flush();
  assert.equal(signal.aborted, true);
  await assert.rejects(
    h.lifecycle.runStep(async () => assert.fail('stale effect')),
  );
  stopped.resolve();
  assert.deepEqual(await h.lifecycle.stop(), {
    state: 'UNCONFIRMED',
    method: null,
  });
  assert.equal(stopCalls, 1);
  assert.equal(h.timers.pending, 0);
});

test('event-loop delay past expiry cannot renew or start another step', async (t) => {
  const h = harness(t);
  await h.lifecycle.start();
  h.timers.advanceTo(15_001);
  await flush();
  assert.equal(h.requests.length, 1);
  await assert.rejects(
    h.lifecycle.runStep(async () => assert.fail('expired step')),
  );
  assert.equal((await h.lifecycle.stop()).state, 'TERMINATED');
  assert.equal(h.timers.pending, 0);
});

test('every new step checks expiry even when watchdog callbacks have not run', async (t) => {
  const h = harness(t);
  await h.lifecycle.start();
  h.timers.now = 15_000;
  await assert.rejects(
    h.lifecycle.runStep(async () => assert.fail('unguarded effect')),
  );
  assert.equal((await h.lifecycle.stop()).state, 'TERMINATED');
  assert.equal(h.requests.length, 1);
  assert.equal(h.stopRequests, 1);
  assert.equal(h.timers.pending, 0);
});

test('a late successful renewal after cancel cannot reopen the assignment', async (t) => {
  const renewed = deferred<Response>();
  let requests = 0;
  const h = harness(t, {
    fetchImpl: async () =>
      ++requests === 1 ? Response.json(ack) : renewed.promise,
  });
  await h.lifecycle.start();
  h.timers.advanceTo(5_000);
  await flush();
  await h.lifecycle.stop();
  renewed.resolve(Response.json(ack));
  await flush();
  await assert.rejects(
    h.lifecycle.runStep(async () => assert.fail('revived step')),
  );
  h.timers.advanceTo(100_000);
  assert.equal(requests, 2);
  assert.equal(h.stopRequests, 1);
  assert.equal(h.timers.pending, 0);
});

test('an effect already in flight keeps its result for later durable reconciliation', async (t) => {
  const h = harness(t);
  const receipt = deferred<string>();
  let signal!: AbortSignal;
  await h.lifecycle.start();
  const effect = h.lifecycle.runStep((current) => {
    signal = current;
    return receipt.promise;
  });
  await h.lifecycle.stop();
  assert.equal(signal.aborted, true);
  receipt.resolve('remote-effect-committed');
  assert.equal(await effect, 'remote-effect-committed');
  await assert.rejects(
    h.lifecycle.runStep(async () => assert.fail('duplicate effect')),
  );
});

test('activation denial is terminal for this lifecycle and never launches or retries', async (t) => {
  const h = harness(t, {
    fetchImpl: async () => new Response(null, { status: 403 }),
  });
  await assert.rejects(h.lifecycle.start(), /startup/i);
  await assert.rejects(h.lifecycle.start(), /stopped/i);
  assert.equal(h.requests.length, 1);
  assert.equal(h.launches.length, 0);
  assert.equal(h.timers.pending, 0);
});

test('activation response latency cannot add time to an expired initial lease', async (t) => {
  const h = harness(t, {
    fetchImpl: async () => {
      h.timers.now = 15_000;
      return Response.json(ack);
    },
  });
  await assert.rejects(h.lifecycle.start(), /startup/i);
  assert.equal(h.launches.length, 0);
  assert.equal(h.timers.pending, 0);
});

test('failure to arm the watchdog prevents sandbox launch', async (t) => {
  const timers = new Timers();
  let calls = 0;
  const h = harness(t, {
    timers: {
      schedule(callback, delayMs) {
        if (++calls === 2) {
          throw new Error('watchdog unavailable');
        }
        return timers.schedule(callback, delayMs);
      },
      cancel: (handle) => timers.cancel(handle),
    },
  });
  await assert.rejects(h.lifecycle.start(), /startup/i);
  assert.equal(h.launches.length, 0);
  assert.equal(timers.pending, 0);
});

test('a hung launch has a bounded startup and late cleanup cannot upgrade its stop evidence', async (t) => {
  const launched = deferred<SandboxHandle>();
  const h = harness(t, {
    launchTimeoutMs: 10,
    driver: {
      async launch() {
        return launched.promise;
      },
      async recover() {
        return null;
      },
    },
  });
  const starting = h.lifecycle.start();
  let settled = false;
  const rejected = assert.rejects(starting, /startup/i).then(() => {
    settled = true;
  });
  try {
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(
      settled,
      true,
      'startup must settle before the driver responds',
    );
    assert.deepEqual(await h.lifecycle.stop(), {
      state: 'UNCONFIRMED',
      method: null,
    });
  } finally {
    launched.resolve(h.handle);
    await h.lifecycle.stop();
    await rejected;
  }
  await flush();
  assert.equal(h.stopRequests, 1);
  assert.deepEqual(await h.lifecycle.stop(), {
    state: 'UNCONFIRMED',
    method: null,
  });
  assert.equal(h.timers.pending, 0);
});

test('sandbox launch rejection cancels renewal and cannot leave an active step gate', async (t) => {
  const h = harness(t, {
    driver: {
      async launch() {
        throw new Error('private adapter failure');
      },
      async recover() {
        return null;
      },
    },
  });
  await assert.rejects(
    h.lifecycle.start(),
    /^Error: Runner assignment startup failed\.$/,
  );
  await assert.rejects(
    h.lifecycle.runStep(async () => assert.fail('unlaunched step')),
  );
  assert.equal((await h.lifecycle.stop()).state, 'UNCONFIRMED');
  assert.equal(h.timers.pending, 0);
});

test('a delayed launch completion cannot outrun its monotonic deadline', async (t) => {
  const h = harness(t, {
    launchTimeoutMs: 100,
    driver: {
      async launch() {
        h.timers.now = 100;
        return h.handle;
      },
      async recover() {
        return null;
      },
    },
  });
  await assert.rejects(h.lifecycle.start(), /startup/i);
  assert.equal((await h.lifecycle.stop()).state, 'TERMINATED');
  assert.equal(h.stopRequests, 1);
  assert.equal(h.timers.pending, 0);
});

test('lease expiry during launch rejects startup and cleans up the late sandbox', async (t) => {
  const launched = deferred<SandboxHandle>();
  const h = harness(t, {
    driver: {
      async launch() {
        return launched.promise;
      },
      async recover() {
        return null;
      },
    },
  });
  const starting = h.lifecycle.start();
  const rejected = assert.rejects(starting, /startup/i);
  await flush();
  h.timers.advanceTo(15_001);
  await rejected;
  await assert.rejects(
    h.lifecycle.runStep(async () => assert.fail('expired launch')),
  );
  launched.resolve(h.handle);
  assert.equal((await h.lifecycle.stop()).state, 'TERMINATED');
  assert.equal(h.requests.length, 1);
  assert.equal(h.stopRequests, 1);
  assert.equal(h.timers.pending, 0);
});

test('quiescing before activation completes prevents launch and cancels renewal', async (t) => {
  const response = deferred<Response>();
  const h = harness(t, { fetchImpl: async () => response.promise });
  const starting = h.lifecycle.start();
  const rejected = assert.rejects(starting, /startup/i);
  await flush();
  h.supervisor.quiesce();
  response.resolve(Response.json(ack));
  await rejected;
  assert.equal(h.launches.length, 0);
  assert.equal((await h.lifecycle.stop()).state, 'UNCONFIRMED');
  assert.equal(h.timers.pending, 0);
});

test('lease expiry between launch enqueue and driver dispatch prevents the actual launch', async (t) => {
  const timers = new Timers();
  let schedules = 0;
  let launchCalls = 0;
  const h = harness(t, {
    timers: {
      schedule(callback, delayMs) {
        if (++schedules === 2) {
          queueMicrotask(() => {
            h.timers.now = 15_000;
          });
        }
        return timers.schedule(callback, delayMs);
      },
      cancel: (handle) => timers.cancel(handle),
    },
    driver: {
      async launch() {
        launchCalls++;
        return h.handle;
      },
      async recover() {
        return null;
      },
    },
  });
  await assert.rejects(h.lifecycle.start(), /startup/i);
  await h.lifecycle.stop();
  assert.equal(launchCalls, 0);
  assert.equal(timers.pending, 0);
});

test(
  'loopback HTTP fixture renews the same scoped command while guarded runtime work runs',
  { timeout: 3_000 },
  async (t) => {
    const grant = command();
    const requests: unknown[] = [];
    const failures: unknown[] = [];
    const server = createServer((request, response) => {
      void (async () => {
        assert.equal(request.url, '/api/runner/v1/leases/activate');
        assert.equal(request.method, 'POST');
        assert.equal(
          request.headers.authorization,
          'Bearer fixture-machine-token',
        );
        assert.equal(request.headers['x-runner-protocol'], '1');
        const chunks: Buffer[] = [];
        for await (const chunk of request) {
          chunks.push(Buffer.from(chunk));
        }
        requests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify(ack));
      })().catch((error: unknown) => {
        failures.push(error);
        response.writeHead(500);
        response.end();
      });
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const timers = new Timers();
    const renewed = deferred<void>();
    let schedules = 0;
    let launches = 0;
    let stops = 0;
    const lifecycle = new RunnerAssignmentLifecycle(grant, {
      ownerSubject: 'owner-one',
      http: {
        origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
        allowHttpLoopbackForTests: true,
        bearerToken: async () => 'fixture-machine-token',
        timeoutMs: 1_000,
      },
      supervisor: new LocalSandboxSupervisor({
        async launch(identity) {
          assert.equal(identity.assignmentId, grant.token.assignmentId);
          launches++;
          return {
            async requestStop() {
              stops++;
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
      }),
      clock: { nowMs: () => timers.now },
      timers: {
        schedule(callback, delayMs) {
          const handle = timers.schedule(callback, delayMs);
          if (++schedules === 4) {
            renewed.resolve();
          }
          return handle;
        },
        cancel: (handle) => timers.cancel(handle),
      },
    });
    t.after(async () => {
      await lifecycle.stop();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    });
    await lifecycle.start();
    const result = deferred<string>();
    const work = lifecycle.runStep(() => result.promise);
    timers.advanceTo(5_000);
    await renewed.promise;
    assert.deepEqual(requests, [grant, grant]);
    assert.deepEqual(failures, []);
    assert.equal(launches, 1);
    result.resolve('fixture-output');
    assert.equal(await work, 'fixture-output');
    assert.equal((await lifecycle.stop()).state, 'TERMINATED');
    assert.equal(stops, 1);
    assert.equal(timers.pending, 0);
  },
);
