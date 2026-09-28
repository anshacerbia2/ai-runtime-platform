import type { GatewayCancelSignal } from '../application/gateway-cancel-signal.port.js';
import {
  gatewayRedisClient,
  type GatewayRedisClient,
} from './gateway-redis.client.js';

const CHANNEL = 'ai-runtime:m2:cancel';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Redis only prompts a durable PostgreSQL cancel-intent read on the owner. */
export class RedisGatewayCancelSignal implements GatewayCancelSignal {
  private owner: string | null = null;

  private constructor(
    private readonly publisher: GatewayRedisClient,
    private readonly subscriber: GatewayRedisClient,
  ) {}

  static async connect(url: string): Promise<RedisGatewayCancelSignal> {
    const publisherConnection = gatewayRedisClient(url);
    const subscriberConnection = gatewayRedisClient(url);
    const publisher = publisherConnection.client;
    const subscriber = subscriberConnection.client;
    try {
      await Promise.all([
        publisherConnection.connect(),
        subscriberConnection.connect(),
      ]);
      return new RedisGatewayCancelSignal(publisher, subscriber);
    } catch (error) {
      await Promise.allSettled([
        publisher.isOpen ? publisher.close() : Promise.resolve(),
        subscriber.isOpen ? subscriber.close() : Promise.resolve(),
      ]);
      throw error;
    }
  }

  async listen(
    ownerInstanceId: string,
    onSignal: (executionId: string) => void,
  ) {
    if (!UUID.test(ownerInstanceId)) {
      throw new Error('Gateway owner instance ID must be a UUID.');
    }
    if (this.owner === ownerInstanceId) {
      return;
    }
    if (this.owner) {
      throw new Error('Gateway cancel subscriber already has an owner.');
    }
    await this.subscriber.subscribe(
      `${CHANNEL}:${ownerInstanceId}`,
      (message) => {
        if (UUID.test(message)) {
          onSignal(message);
        }
      },
    );
    this.owner = ownerInstanceId;
  }

  async notify(ownerInstanceId: string, executionId: string) {
    if (!UUID.test(ownerInstanceId) || !UUID.test(executionId)) {
      throw new Error('Gateway cancel signal identifiers must be UUIDs.');
    }
    await this.publisher.publish(`${CHANNEL}:${ownerInstanceId}`, executionId);
  }

  async onModuleDestroy() {
    await Promise.allSettled([
      this.publisher.isOpen ? this.publisher.close() : Promise.resolve(),
      this.subscriber.isOpen ? this.subscriber.close() : Promise.resolve(),
    ]);
  }
}
