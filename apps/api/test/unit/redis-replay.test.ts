import test from 'node:test';
import assert from 'node:assert/strict';
import type { GatewayStreamEvent } from '@ai-runtime/contracts/http';
import { RedisReplayStore } from '../../src/modules/gateway/infrastructure/redis-replay.store.js';

const executionId = '00000000-0000-4000-8000-000000000441';

function event(
  sequence: number,
  type: GatewayStreamEvent['type'] = 'model.delta',
): GatewayStreamEvent {
  return {
    schema_version: '1',
    id: `${executionId}:${sequence}`,
    execution_id: executionId,
    sequence,
    type,
    occurred_at: new Date().toISOString(),
    payload: type === 'model.delta' ? { text: `chunk-${sequence}` } : {},
  };
}

// Both adapter instances use one fake Redis command surface. This exercises the
// cross-instance cursor path without starting a provider or relying on local RAM.
class SharedRedis {
  private readonly streams = new Map<
    string,
    Array<{ id: string; message: { payload: string; bytes: string } }>
  >();

  async eval(
    _script: string,
    options: { keys: string[]; arguments: string[] },
  ) {
    const key = options.keys[0]!;
    const [id, payload, bytes] = options.arguments;
    const rows = this.streams.get(key) ?? [];
    if (
      rows.length &&
      Number(rows.at(-1)!.id.split('-')[0]) >= Number(id!.split('-')[0])
    ) {
      throw new Error('The ID specified in XADD is equal or smaller.');
    }
    rows.push({ id: id!, message: { payload: payload!, bytes: bytes! } });
    while (rows.length > 256) {
      rows.shift();
    }
    let total = rows.reduce((sum, row) => sum + Number(row.message.bytes), 0);
    while (total > 262_144) {
      total -= Number(rows.shift()!.message.bytes);
    }
    this.streams.set(key, rows);
    return 1;
  }

  async xRange(
    key: string,
    start: string,
    end: string,
    options: { COUNT: number },
  ) {
    const rows = this.streams.get(key) ?? [];
    const minimum =
      start === '-' ? -1 : Number(start.replace('(', '').split('-')[0]);
    const strict = start.startsWith('(');
    return rows
      .filter((row) => {
        const number = Number(row.id.split('-')[0]);
        return (strict ? number > minimum : number >= minimum) && end === '+';
      })
      .slice(0, options.COUNT);
  }

  async exists(key: string) {
    return Number(this.streams.has(key));
  }

  async del(key: string) {
    return Number(this.streams.delete(key));
  }
}

function stores() {
  const redis = new SharedRedis();
  const client = redis as unknown as ConstructorParameters<
    typeof RedisReplayStore
  >[0];
  return [new RedisReplayStore(client), new RedisReplayStore(client)] as const;
}

test('a second API instance resumes and tails the first instance without dispatching again', async () => {
  const [owner, reader] = stores();
  const started = event(0, 'execution.started');
  await owner.append(started);
  const watch = await reader.watch(executionId, started.id, true);
  assert.deepEqual(watch.page, { expired: false, events: [] });

  const pending = watch.next();
  const delta = event(1);
  await owner.append(delta);
  assert.deepEqual(await pending, delta);

  const completed = event(2, 'execution.completed');
  await owner.append(completed);
  assert.deepEqual(await watch.next(), completed);
  assert.equal(await watch.next(), null);
  watch.close();

  const resumed = await reader.read(executionId, started.id);
  assert.deepEqual(
    resumed.events.map((item) => item.id),
    [delta.id, completed.id],
  );
});

test('a trimmed or foreign replay cursor expires instead of silently restarting', async () => {
  const [owner, reader] = stores();
  for (let sequence = 0; sequence <= 256; sequence++) {
    await owner.append(event(sequence));
  }
  assert.equal((await reader.read(executionId, event(0).id)).expired, true);
  assert.equal((await reader.read(executionId, 'other:4')).expired, true);
  assert.equal((await reader.read(executionId, event(255).id)).expired, false);
});
