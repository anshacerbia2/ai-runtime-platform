import { createClient } from 'redis';

const CONNECT_TIMEOUT_MS = 3_000;
const COMMAND_TIMEOUT_MS = 3_000;
const MAX_RECONNECT_DELAY_MS = 1_000;

/**
 * Startup fails after one retry so a pod never advertises a Redis-backed
 * gateway while its hot tier is absent. After the first healthy connection,
 * the client keeps reconnecting with bounded backoff. Offline commands still
 * fail immediately; PostgreSQL remains the execution authority.
 */
export function gatewayRedisClient(url: string) {
  let connectedOnce = false;
  const client = createClient({
    url,
    socket: {
      connectTimeout: CONNECT_TIMEOUT_MS,
      reconnectStrategy: (retries) => {
        if (!connectedOnce && retries >= 1) {
          return new Error('Initial Redis connection retry budget exhausted.');
        }
        return Math.min(MAX_RECONNECT_DELAY_MS, 50 * 2 ** Math.min(retries, 5));
      },
    },
    commandOptions: { timeout: COMMAND_TIMEOUT_MS },
    disableOfflineQueue: true,
  });
  client.on('error', () => {
    /* The active operation reports failure; reconnect continues in background. */
  });
  return {
    client,
    async connect() {
      await client.connect();
      connectedOnce = true;
      return client;
    },
  };
}

export type GatewayRedisClient = ReturnType<
  typeof gatewayRedisClient
>['client'];
