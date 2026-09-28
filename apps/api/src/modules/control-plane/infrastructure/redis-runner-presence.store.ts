import {
  runtimeRedisClient,
  type RuntimeRedisClient,
} from '../../../infrastructure/redis/runtime-redis.client.js';
import type { RunnerRegistrationIdentity } from '../application/runner-liveness-registry.port.js';
import type {
  RunnerPresenceMatch,
  RunnerPresenceProof,
  RunnerPresenceStore,
} from '../application/runner-presence-store.port.js';
import {
  assertRunnerPresenceTtl,
  encodeRunnerPresence,
  runnerPresenceIdentity,
  runnerPresenceKey,
} from './runner-presence-proof.js';

export class RedisRunnerPresenceStore implements RunnerPresenceStore {
  constructor(
    private readonly client: RuntimeRedisClient,
    private readonly prefix = 'ai-runtime:m3:runner-presence',
  ) {}

  static async connect(url: string): Promise<RedisRunnerPresenceStore> {
    const connection = runtimeRedisClient(url);
    return new RedisRunnerPresenceStore(await connection.connect());
  }

  async heartbeat(proof: RunnerPresenceProof, ttlMs: number): Promise<void> {
    assertRunnerPresenceTtl(ttlMs);
    await this.client.set(
      runnerPresenceKey(this.prefix, proof),
      encodeRunnerPresence(proof),
      { PX: ttlMs },
    );
  }

  async inspect(
    registration: RunnerRegistrationIdentity,
  ): Promise<RunnerPresenceMatch> {
    const current = await this.client.get(
      runnerPresenceKey(this.prefix, registration),
    );
    if (current === null) {
      return 'MISSING';
    }
    return current.startsWith(`${runnerPresenceIdentity(registration)}:`)
      ? 'CURRENT'
      : 'MISMATCH';
  }

  async onModuleDestroy() {
    if (this.client.isOpen) {
      await this.client.close();
    }
  }
}
