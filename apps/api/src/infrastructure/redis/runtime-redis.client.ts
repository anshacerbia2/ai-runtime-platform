import { createClient } from 'redis';

const CONNECT_TIMEOUT_MS = 3_000;
const COMMAND_TIMEOUT_MS = 3_000;
const MAX_RECONNECT_DELAY_MS = 1_000;

/**
 * Shared Redis transport policy for bounded runtime projections. Startup fails
 * after one retry, while an established client reconnects with bounded backoff.
 * Offline commands fail immediately so Redis cannot masquerade as authority.
 */
export function runtimeRedisClient(url: string) {
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

export type RuntimeRedisClient = ReturnType<
  typeof runtimeRedisClient
>['client'];
