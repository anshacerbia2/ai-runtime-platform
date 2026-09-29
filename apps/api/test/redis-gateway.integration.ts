import { randomUUID } from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from 'redis';
import type { GatewayStreamEvent } from '@ai-runtime/contracts/http';
import { loadConfig } from '../src/infrastructure/config/environment-config.js';
import { gatewayRedisClient } from '../src/modules/gateway/infrastructure/gateway-redis.client.js';
import { RedisGatewayCircuit } from '../src/modules/gateway/infrastructure/redis-gateway.circuit.js';
import { RedisGatewayCancelSignal } from '../src/modules/gateway/infrastructure/redis-gateway-cancel.signal.js';
import { RedisReplayStore } from '../src/modules/gateway/infrastructure/redis-replay.store.js';

const url = loadConfig().gateway.replayRedisUrl;
if (!url) {
  throw new Error(
    'Set M2_REPLAY_REDIS_URL to run the real Redis gateway test.',
  );
}

function event(
  executionId: string,
  sequence: number,
  type: GatewayStreamEvent['type'] = 'model.delta',
  text = 'part',
): GatewayStreamEvent {
  return {
    schema_version: '1',
    id: `${executionId}:${sequence}`,
    execution_id: executionId,
    sequence,
    type,
    occurred_at: new Date().toISOString(),
    payload: type === 'model.delta' ? { text } : {},
  };
}

async function deadline<T>(work: Promise<T>, milliseconds = 3_000) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error('Redis integration operation timed out.')),
      milliseconds,
    );
    timer.unref();
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function eventually<T>(work: () => Promise<T>, milliseconds = 3_000) {
  const expiresAt = Date.now() + milliseconds;
  let lastError: unknown;
  while (Date.now() < expiresAt) {
    try {
      return await work();
    } catch (error) {
      lastError = error;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 50);
        timer.unref();
      });
    }
  }
  throw lastError ?? new Error('Redis connection did not recover.');
}

test('gateway Redis client reconnects after its established socket is killed', async () => {
  const connection = gatewayRedisClient(url);
  const client = await connection.connect();
  const admin = createClient({ url });
  try {
    await admin.connect();
    const clientId = await client.clientId();
    assert.equal(
      await admin.sendCommand(['CLIENT', 'KILL', 'ID', String(clientId)]),
      1,
    );
    assert.equal(await eventually(() => client.ping()), 'PONG');
  } finally {
    await Promise.allSettled([
      client.isOpen ? client.close() : Promise.resolve(),
      admin.isOpen ? admin.close() : Promise.resolve(),
    ]);
  }
});

test('separate Redis clients resume one stream and admit one half-open probe', async () => {
  const owner = await RedisReplayStore.connect(url);
  const reader = await RedisReplayStore.connect(url);
  const first = await RedisGatewayCircuit.connect(url);
  const second = await RedisGatewayCircuit.connect(url);
  const admin = createClient({ url });
  const executionId = randomUUID();
  const route = {
    connectionId: randomUUID(),
    provider: 'openrouter' as const,
    model: 'redis-integration-model',
  };
  let circuitKey: string | null = null;
  try {
    await admin.connect();
    const started = event(executionId, 0, 'execution.started');
    await owner.append(started);
    const watch = await reader.watch(executionId, started.id, true);
    try {
      const pending = watch.next();
      const delta = event(executionId, 1);
      await owner.append(delta);
      assert.deepEqual(await deadline(pending), delta);
      const completed = event(executionId, 2, 'execution.completed');
      await owner.append(completed);
      assert.deepEqual(await deadline(watch.next()), completed);
      assert.equal(await watch.next(), null);
    } finally {
      watch.close();
    }

    const stale = await first.acquire(route, 1000);
    assert.ok(stale);
    circuitKey = stale.key;
    for (let index = 0; index < 3; index++) {
      const permit = await first.acquire(route, 1000);
      assert.ok(permit);
      await first.report(permit, 'ambiguous');
    }
    assert.equal(await second.acquire(route, 1000), null);
    // Advance only this test's unique route past cooldown, without a 30s sleep.
    await admin.hSet(circuitKey, 'open_until', '0');
    const [one, two] = await Promise.all([
      first.acquire(route, 1000),
      second.acquire(route, 1000),
    ]);
    const probes = [one, two].filter((permit) => permit?.probe);
    assert.equal(probes.length, 1);
    assert.equal([one, two].filter((permit) => permit === null).length, 1);
    await first.report(stale, 'success');
    assert.equal(await second.acquire(route, 1000), null);
    await second.report(probes[0]!, 'success');
    assert.equal((await first.acquire(route, 1000))?.probe, false);
  } finally {
    await Promise.allSettled([
      owner.clear(executionId),
      circuitKey && admin.isOpen ? admin.del(circuitKey) : Promise.resolve(),
    ]);
    await Promise.allSettled([
      owner.onModuleDestroy(),
      reader.onModuleDestroy(),
      first.onModuleDestroy(),
      second.onModuleDestroy(),
      admin.isOpen ? admin.close() : Promise.resolve(),
    ]);
  }
});

test('real Redis enforces event, count, byte and retention bounds', async () => {
  const replay = await RedisReplayStore.connect(url);
  const admin = createClient({ url });
  const countExecution = randomUUID();
  const byteExecution = randomUUID();
  const oversizedExecution = randomUUID();
  try {
    await admin.connect();
    await assert.rejects(
      replay.append(
        event(oversizedExecution, 0, 'model.delta', 'x'.repeat(70_000)),
      ),
      /maximum encoded size/i,
    );
    assert.equal(
      await admin.exists(`ai-runtime:m2:replay:${oversizedExecution}`),
      0,
    );

    for (let sequence = 0; sequence <= 256; sequence++) {
      await replay.append(event(countExecution, sequence));
    }
    assert.equal(
      (await replay.read(countExecution, `${countExecution}:0`)).expired,
      true,
    );
    assert.equal((await replay.read(countExecution)).events.length, 256);
    const countTtl = await admin.ttl(`ai-runtime:m2:replay:${countExecution}`);
    assert.ok(countTtl > 0 && countTtl <= 600, String(countTtl));

    for (let sequence = 0; sequence < 6; sequence++) {
      await replay.append(
        event(byteExecution, sequence, 'model.delta', 'y'.repeat(50_000)),
      );
    }
    const retained = await replay.read(byteExecution);
    assert.ok(retained.events.length < 6);
    assert.equal(
      (await replay.read(byteExecution, `${byteExecution}:0`)).expired,
      true,
    );
    assert.ok(
      Buffer.byteLength(JSON.stringify(retained.events), 'utf8') <= 262_144,
    );
  } finally {
    await Promise.allSettled([
      replay.clear(countExecution),
      replay.clear(byteExecution),
      replay.clear(oversizedExecution),
    ]);
    await Promise.allSettled([
      replay.onModuleDestroy(),
      admin.isOpen ? admin.close() : Promise.resolve(),
    ]);
  }
});

test('real Redis loss emits reset instead of presenting a continuous history', async () => {
  const owner = await RedisReplayStore.connect(url);
  const reader = await RedisReplayStore.connect(url);
  const admin = createClient({ url });
  const executionId = randomUUID();
  try {
    await admin.connect();
    const started = event(executionId, 0, 'execution.started');
    await owner.append(started);
    const watch = await reader.watch(executionId, started.id, true);
    try {
      await admin.del(`ai-runtime:m2:replay:${executionId}`);
      const reset = await deadline(watch.next());
      assert.equal(reset?.type, 'stream.reset_required');
      assert.equal(reset?.sequence, 1);
      assert.equal(await watch.next(), null);
    } finally {
      watch.close();
    }
    assert.equal((await reader.read(executionId, started.id)).expired, true);
  } finally {
    await Promise.allSettled([
      owner.clear(executionId),
      owner.onModuleDestroy(),
      reader.onModuleDestroy(),
      admin.isOpen ? admin.close() : Promise.resolve(),
    ]);
  }
});

test('real Redis Pub/Sub prompts the selected owner instance only', async () => {
  const listener = await RedisGatewayCancelSignal.connect(url);
  const notifier = await RedisGatewayCancelSignal.connect(url);
  const ownerInstanceId = randomUUID();
  const executionId = randomUUID();
  let resolveReceived!: (value: string) => void;
  const received = new Promise<string>((resolve) => {
    resolveReceived = resolve;
  });
  try {
    await listener.listen(ownerInstanceId, resolveReceived);
    await notifier.notify(ownerInstanceId, executionId);
    assert.equal(await deadline(received), executionId);
  } finally {
    await Promise.allSettled([
      listener.onModuleDestroy(),
      notifier.onModuleDestroy(),
    ]);
  }
});
