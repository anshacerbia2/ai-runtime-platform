import { randomUUID } from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from 'redis';
import type { GatewayStreamEvent } from '@ai-runtime/contracts/http';
import { RedisGatewayCircuit } from '../src/modules/gateway/infrastructure/redis-gateway.circuit.js';
import { RedisReplayStore } from '../src/modules/gateway/infrastructure/redis-replay.store.js';

const url = process.env.M2_REPLAY_REDIS_URL;
if (!url) {
  throw new Error(
    'Set M2_REPLAY_REDIS_URL to run the real Redis gateway test.',
  );
}

test('separate Redis clients share bounded replay and one half-open probe', async () => {
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
    const event = (
      sequence: number,
      type: GatewayStreamEvent['type'],
    ): GatewayStreamEvent => ({
      schema_version: '1',
      id: `${executionId}:${sequence}`,
      execution_id: executionId,
      sequence,
      type,
      occurred_at: new Date().toISOString(),
      payload: type === 'model.delta' ? { text: 'part' } : {},
    });
    const started = event(0, 'execution.started');
    await owner.append(started);
    const watch = await reader.watch(executionId, started.id, true);
    try {
      const pending = watch.next();
      const delta = event(1, 'model.delta');
      await owner.append(delta);
      assert.deepEqual(await pending, delta);
      const completed = event(2, 'execution.completed');
      await owner.append(completed);
      assert.deepEqual(await watch.next(), completed);
      assert.equal(await watch.next(), null);
    } finally {
      watch.close();
    }

    const stale = await first.acquire(route, 1000);
    assert.ok(stale);
    circuitKey = stale.key;
    for (let i = 0; i < 3; i++) {
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
