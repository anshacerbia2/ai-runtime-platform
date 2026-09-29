import { createHash, randomUUID } from 'node:crypto';
import type {
  CircuitOutcome,
  CircuitPermit,
  CircuitRoute,
  GatewayCircuit,
} from '../application/gateway-circuit.port.js';
import {
  gatewayRedisClient,
  type GatewayRedisClient,
} from './gateway-redis.client.js';

const OPEN_MS = 30_000;
const STATE_MS = 90_000;

// Redis TIME and one Lua command make the route decision shared and atomic.
// The probe lease exceeds the provider deadline; a dead owner cannot hold it forever.
const ACQUIRE = `
redis.replicate_commands()
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
local epoch = redis.call('HGET', KEYS[1], 'epoch')
if not epoch then
  epoch = ARGV[1]
  redis.call('HSET', KEYS[1], 'epoch', epoch, 'failures', 0, 'open_until', 0)
end
local open_until = tonumber(redis.call('HGET', KEYS[1], 'open_until') or '0')
local probe_until = tonumber(redis.call('HGET', KEYS[1], 'probe_until') or '0')
if open_until > now or probe_until > now then return {'deny'} end
local failures = tonumber(redis.call('HGET', KEYS[1], 'failures') or '0')
redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[3]))
if failures >= 3 then
  redis.call('HSET', KEYS[1], 'probe_token', ARGV[2], 'probe_until', now + tonumber(ARGV[4]))
  return {'probe', epoch}
end
return {'closed', epoch}
`;

const REPORT = `
redis.replicate_commands()
local epoch = redis.call('HGET', KEYS[1], 'epoch')
if not epoch or epoch ~= ARGV[1] then return 0 end
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
if ARGV[2] == 'probe' then
  if redis.call('HGET', KEYS[1], 'probe_token') ~= ARGV[3] then return 0 end
  if ARGV[4] == 'success' then
    redis.call('DEL', KEYS[1])
    return 1
  end
  redis.call('HDEL', KEYS[1], 'probe_token', 'probe_until')
  if ARGV[4] == 'ambiguous' then
    redis.call('HSET', KEYS[1], 'epoch', ARGV[5], 'failures', 3, 'open_until', now + ${OPEN_MS})
  end
  redis.call('PEXPIRE', KEYS[1], ${STATE_MS})
  return 1
end
if redis.call('HEXISTS', KEYS[1], 'probe_token') == 1 then return 0 end
if tonumber(redis.call('HGET', KEYS[1], 'open_until') or '0') > now then return 0 end
if ARGV[4] == 'success' then
  redis.call('HSET', KEYS[1], 'failures', 0)
elseif ARGV[4] == 'ambiguous' then
  local failures = redis.call('HINCRBY', KEYS[1], 'failures', 1)
  if failures >= 3 then
    redis.call('HSET', KEYS[1], 'epoch', ARGV[5], 'open_until', now + ${OPEN_MS})
  end
end
redis.call('PEXPIRE', KEYS[1], ${STATE_MS})
return 1
`;

export class RedisGatewayCircuit implements GatewayCircuit {
  constructor(private readonly client: GatewayRedisClient) {}

  static async connect(url: string): Promise<RedisGatewayCircuit> {
    const connection = gatewayRedisClient(url);
    return new RedisGatewayCircuit(await connection.connect());
  }

  async onModuleDestroy() {
    if (this.client.isOpen) {
      await this.client.close();
    }
  }

  async acquire(
    route: CircuitRoute,
    timeoutMs: number,
  ): Promise<CircuitPermit | null> {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
      throw new Error('Provider timeout must be a positive integer.');
    }
    const digest = createHash('sha256')
      .update(JSON.stringify([route.connectionId, route.provider, route.model]))
      .digest('hex');
    const key = `ai-runtime:m2:circuit:${digest}`;
    const token = randomUUID();
    const probeLease = timeoutMs + 30_000;
    const stateLease = Math.max(probeLease + 30_000, STATE_MS);
    const result = await this.client.eval(ACQUIRE, {
      keys: [key],
      arguments: [randomUUID(), token, String(stateLease), String(probeLease)],
    });
    if (!Array.isArray(result) || typeof result[0] !== 'string') {
      throw new Error('Invalid Redis circuit acquisition response.');
    }
    if (result[0] === 'deny') {
      return null;
    }
    if (
      (result[0] !== 'probe' && result[0] !== 'closed') ||
      typeof result[1] !== 'string'
    ) {
      throw new Error('Invalid Redis circuit permit.');
    }
    return { key, epoch: result[1], probe: result[0] === 'probe', token };
  }

  async report(permit: CircuitPermit, outcome: CircuitOutcome): Promise<void> {
    await this.client.eval(REPORT, {
      keys: [permit.key],
      arguments: [
        permit.epoch,
        permit.probe ? 'probe' : 'closed',
        permit.token,
        outcome,
        randomUUID(),
      ],
    });
  }
}
