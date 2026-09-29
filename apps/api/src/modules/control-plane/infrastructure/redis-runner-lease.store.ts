import {
  runtimeRedisClient,
  type RuntimeRedisClient,
} from '../../../infrastructure/redis/runtime-redis.client.js';
import type {
  RunnerLeaseInstallResult,
  RunnerLeaseMatchResult,
  RunnerLeaseProof,
  RunnerLeaseDurableProof,
  RunnerLeaseReleaseResult,
  RunnerLeaseRenewResult,
  RunnerLeaseStore,
} from '../application/runner-lease-store.port.js';
import {
  assertRunnerLeaseTtl,
  encodeRunnerLeaseProof,
  matchDurableRunnerLease,
  runnerLeaseKey,
} from './runner-lease-proof.js';

const INSTALL = `
local current = redis.call('GET', KEYS[1])
if not current then
  redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2], 'NX')
  return 1
end
if current == ARGV[1] then
  redis.call('PEXPIRE', KEYS[1], ARGV[2])
  return 2
end
return 0
`;

// Renewal deliberately has no SET path: a missing lease remains lost.
const RENEW = `
local current = redis.call('GET', KEYS[1])
if not current then return 0 end
if current ~= ARGV[1] then return -1 end
redis.call('PEXPIRE', KEYS[1], ARGV[2])
return 1
`;

const RELEASE = `
local current = redis.call('GET', KEYS[1])
if not current then return 0 end
if current ~= ARGV[1] then return -1 end
redis.call('DEL', KEYS[1])
return 1
`;

/** Exact-token compare/renew lease projection; it never grants durable authority. */
export class RedisRunnerLeaseStore implements RunnerLeaseStore {
  constructor(
    private readonly client: RuntimeRedisClient,
    private readonly prefix = 'ai-runtime:m3:lease',
  ) {}

  static async connect(url: string): Promise<RedisRunnerLeaseStore> {
    const connection = runtimeRedisClient(url);
    return new RedisRunnerLeaseStore(await connection.connect());
  }

  async install(
    proof: RunnerLeaseProof,
    ttlMs: number,
  ): Promise<RunnerLeaseInstallResult> {
    assertRunnerLeaseTtl(ttlMs);
    const result = Number(
      await this.client.eval(INSTALL, {
        keys: [runnerLeaseKey(this.prefix, proof)],
        arguments: [encodeRunnerLeaseProof(proof), String(ttlMs)],
      }),
    );
    return result === 1 ? 'INSTALLED' : result === 2 ? 'REFRESHED' : 'CONFLICT';
  }

  async inspect(proof: RunnerLeaseProof): Promise<RunnerLeaseMatchResult> {
    const current = await this.client.get(runnerLeaseKey(this.prefix, proof));
    return current === null
      ? 'MISSING'
      : current === encodeRunnerLeaseProof(proof)
        ? 'CURRENT'
        : 'MISMATCH';
  }

  async inspectDurable(
    proof: RunnerLeaseDurableProof,
  ): Promise<RunnerLeaseMatchResult> {
    const current = await this.client.get(runnerLeaseKey(this.prefix, proof));
    return matchDurableRunnerLease(current, proof);
  }

  async renew(
    proof: RunnerLeaseProof,
    ttlMs: number,
  ): Promise<RunnerLeaseRenewResult> {
    assertRunnerLeaseTtl(ttlMs);
    const result = Number(
      await this.client.eval(RENEW, {
        keys: [runnerLeaseKey(this.prefix, proof)],
        arguments: [encodeRunnerLeaseProof(proof), String(ttlMs)],
      }),
    );
    return result === 1 ? 'RENEWED' : result === -1 ? 'MISMATCH' : 'MISSING';
  }

  async release(proof: RunnerLeaseProof): Promise<RunnerLeaseReleaseResult> {
    const result = Number(
      await this.client.eval(RELEASE, {
        keys: [runnerLeaseKey(this.prefix, proof)],
        arguments: [encodeRunnerLeaseProof(proof)],
      }),
    );
    return result === 1 ? 'RELEASED' : result === -1 ? 'MISMATCH' : 'MISSING';
  }

  async onModuleDestroy() {
    if (this.client.isOpen) {
      await this.client.close();
    }
  }
}
