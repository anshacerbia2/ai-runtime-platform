import { GatewayStreamEvent } from '@ai-runtime/contracts/http';
import type {
  ReplayPage,
  ReplayStore,
  ReplayWatch,
} from '../application/replay-store.port.js';
import {
  gatewayRedisClient,
  type GatewayRedisClient,
} from './gateway-redis.client.js';

const MAX_EVENTS = 256;
const MAX_BYTES = 262_144;
const MAX_EVENT_BYTES = 65_536;
const RETENTION_SECONDS = 600;
const POLL_MS = 200;
const terminal = new Set<GatewayStreamEvent['type']>([
  'execution.completed',
  'execution.failed',
  'execution.cancelled',
  'stream.reset_required',
]);

// XADD, both retention bounds, and TTL advance together. Event payloads are
// already bounded before this script runs. PostgreSQL remains the result source.
const APPEND = `
redis.call('XADD', KEYS[1], ARGV[1], 'payload', ARGV[2], 'bytes', ARGV[3])
redis.call('XTRIM', KEYS[1], 'MAXLEN', '=', ${MAX_EVENTS})
local rows = redis.call('XRANGE', KEYS[1], '-', '+')
local bytes = 0
local cutoff = rows[#rows][1]
for i = #rows, 1, -1 do
  local size = tonumber(rows[i][2][4])
  if bytes + size > ${MAX_BYTES} then break end
  bytes = bytes + size
  cutoff = rows[i][1]
end
redis.call('XTRIM', KEYS[1], 'MINID', '=', cutoff)
redis.call('EXPIRE', KEYS[1], ${RETENTION_SECONDS})
return 1
`;

type StreamRow = Awaited<ReturnType<GatewayRedisClient['xRange']>>[number];

function redisId(sequence: number) {
  return `${sequence + 1}-0`;
}

function sequenceFromCursor(executionId: string, cursor: string) {
  const prefix = `${executionId}:`;
  if (!cursor.startsWith(prefix)) {
    return null;
  }
  const value = cursor.slice(prefix.length);
  if (!/^(0|[1-9][0-9]*)$/.test(value)) {
    return null;
  }
  const sequence = Number(value);
  return Number.isSafeInteger(sequence) ? sequence : null;
}

function decoded(row: StreamRow) {
  if (typeof row.message.payload !== 'string') {
    throw new Error('Replay row has no event payload.');
  }
  return GatewayStreamEvent.parse(JSON.parse(row.message.payload));
}

function reset(executionId: string, sequence: number): GatewayStreamEvent {
  return GatewayStreamEvent.parse({
    schema_version: '1',
    id: `${executionId}:reset:${sequence}`,
    execution_id: executionId,
    sequence,
    type: 'stream.reset_required',
    occurred_at: new Date().toISOString(),
    payload: { reason: 'replay_gap' },
  });
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });
  });
}

/** Redis is bounded hot replay only; it never becomes execution authority. */
export class RedisReplayStore implements ReplayStore {
  constructor(
    private readonly client: GatewayRedisClient,
    private readonly prefix = 'ai-runtime:m2:replay',
  ) {}

  static async connect(url: string): Promise<RedisReplayStore> {
    const connection = gatewayRedisClient(url);
    return new RedisReplayStore(await connection.connect());
  }

  async onModuleDestroy() {
    if (this.client.isOpen) {
      await this.client.close();
    }
  }

  private key(executionId: string) {
    return `${this.prefix}:${executionId}`;
  }

  async append(raw: GatewayStreamEvent) {
    const event = GatewayStreamEvent.parse(raw);
    if (event.id !== `${event.execution_id}:${event.sequence}`) {
      throw new Error('Replay event ID does not match its execution sequence.');
    }
    const payload = JSON.stringify(event);
    const bytes = Buffer.byteLength(payload, 'utf8');
    if (bytes > MAX_EVENT_BYTES) {
      throw new Error('Replay event exceeds the maximum encoded size.');
    }
    await this.client.eval(APPEND, {
      keys: [this.key(event.execution_id)],
      arguments: [redisId(event.sequence), payload, String(bytes)],
    });
  }

  async read(executionId: string, after?: string): Promise<ReplayPage> {
    const cursor =
      after === undefined ? null : sequenceFromCursor(executionId, after);
    if (after !== undefined && cursor === null) {
      return { expired: true, events: [] };
    }
    const rows = await this.client.xRange(this.key(executionId), '-', '+', {
      COUNT: MAX_EVENTS,
    });
    if (after === undefined) {
      return { expired: false, events: rows.map(decoded) };
    }
    const index = rows.findIndex((row) => row.id === redisId(cursor!));
    return index < 0
      ? { expired: true, events: [] }
      : { expired: false, events: rows.slice(index + 1).map(decoded) };
  }

  async watch(
    executionId: string,
    after?: string,
    live = true,
  ): Promise<ReplayWatch> {
    const page = await this.read(executionId, after);
    const last = page.events.at(-1);
    if (page.expired || !live || (last && terminal.has(last.type))) {
      return { page, next: async () => null, close() {} };
    }
    const stopped = new AbortController();
    let sequence =
      last?.sequence ?? (after ? sequenceFromCursor(executionId, after) : null);
    let cursor = sequence === null ? '0-0' : redisId(sequence);
    return {
      page,
      close: () => stopped.abort(),
      next: async (signal?: AbortSignal) => {
        const abort = () => stopped.abort();
        signal?.addEventListener('abort', abort, { once: true });
        try {
          while (!stopped.signal.aborted) {
            const rows = await this.client.xRange(
              this.key(executionId),
              `(${cursor}`,
              '+',
              { COUNT: 1 },
            );
            const row = rows[0];
            if (row) {
              const event = decoded(row);
              if (sequence !== null && event.sequence !== sequence + 1) {
                stopped.abort();
                return reset(executionId, sequence + 1);
              }
              sequence = event.sequence;
              cursor = row.id;
              if (terminal.has(event.type)) {
                stopped.abort();
              }
              return event;
            }
            if (sequence !== null) {
              const exists = await this.client.exists(this.key(executionId));
              if (!exists) {
                stopped.abort();
                return reset(executionId, sequence + 1);
              }
            }
            await wait(POLL_MS, stopped.signal);
          }
          return null;
        } finally {
          signal?.removeEventListener('abort', abort);
        }
      },
    };
  }

  async clear(executionId: string) {
    await this.client.del(this.key(executionId));
  }
}
