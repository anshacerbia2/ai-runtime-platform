import {
  runtimeRedisClient,
  type RuntimeRedisClient,
} from '../../../infrastructure/redis/runtime-redis.client.js';
import type { RunnerCoordinationStore } from '../application/runner-coordination.port.js';

const KEY = 'ai-runtime:m3:runner-coordination-epoch';

export class RedisRunnerCoordinationStore implements RunnerCoordinationStore {
  constructor(private readonly client: RuntimeRedisClient) {}

  static async connect(url: string): Promise<RedisRunnerCoordinationStore> {
    const connection = runtimeRedisClient(url);
    return new RedisRunnerCoordinationStore(await connection.connect());
  }

  read() {
    return this.client.get(KEY);
  }

  async write(marker: string) {
    await this.client.set(KEY, marker);
  }

  async onModuleDestroy() {
    if (this.client.isOpen) {
      await this.client.close();
    }
  }
}
