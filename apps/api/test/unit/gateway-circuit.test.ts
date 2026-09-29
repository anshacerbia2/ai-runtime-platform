import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryGatewayCircuit } from '../../src/modules/gateway/infrastructure/in-memory-gateway.circuit.js';

const primary = {
  connectionId: 'connection-a',
  provider: 'openrouter' as const,
  model: 'model-a',
};

test('three ambiguous failures open only the affected connection and route', async () => {
  const circuit = new InMemoryGatewayCircuit();
  for (let i = 0; i < 3; i++) {
    const permit = await circuit.acquire(primary, 1000);
    assert.ok(permit);
    await circuit.report(permit, 'ambiguous');
  }
  assert.equal(await circuit.acquire(primary, 1000), null);
  assert.ok(
    await circuit.acquire({ ...primary, connectionId: 'connection-b' }, 1000),
  );
  assert.ok(await circuit.acquire({ ...primary, model: 'model-b' }, 1000));
});

test('cooldown admits one half-open probe and fences stale in-flight reports', async () => {
  const originalNow = Date.now;
  let now = 1_000_000;
  Date.now = () => now;
  try {
    const circuit = new InMemoryGatewayCircuit();
    const stale = await circuit.acquire(primary, 1000);
    assert.ok(stale);
    for (let i = 0; i < 3; i++) {
      const permit = await circuit.acquire(primary, 1000);
      assert.ok(permit);
      await circuit.report(permit, 'ambiguous');
    }
    assert.equal(await circuit.acquire(primary, 1000), null);
    now += 30_001;
    const probe = await circuit.acquire(primary, 1000);
    assert.ok(probe?.probe);
    assert.equal(await circuit.acquire(primary, 1000), null);
    await circuit.report(stale, 'success');
    assert.equal(await circuit.acquire(primary, 1000), null);
    await circuit.report(probe, 'ambiguous');
    assert.equal(await circuit.acquire(primary, 1000), null);
    now += 30_001;
    const secondProbe = await circuit.acquire(primary, 1000);
    assert.ok(secondProbe?.probe);
    await circuit.report(probe, 'success');
    assert.equal(await circuit.acquire(primary, 1000), null);
    await circuit.report(secondProbe, 'success');
    assert.equal((await circuit.acquire(primary, 1000))?.probe, false);
  } finally {
    Date.now = originalNow;
  }
});

test('a neutral half-open outcome releases the probe without healing the route', async () => {
  const originalNow = Date.now;
  let now = 1_000_000;
  Date.now = () => now;
  try {
    const circuit = new InMemoryGatewayCircuit();
    for (let i = 0; i < 3; i++) {
      const permit = await circuit.acquire(primary, 1000);
      assert.ok(permit);
      await circuit.report(permit, 'ambiguous');
    }
    now += 30_001;
    const probe = await circuit.acquire(primary, 1000);
    assert.ok(probe?.probe);
    await circuit.report(probe, 'neutral');
    assert.equal((await circuit.acquire(primary, 1000))?.probe, true);
  } finally {
    Date.now = originalNow;
  }
});
