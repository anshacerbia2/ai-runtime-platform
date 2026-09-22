import 'server-only';
import { createClient } from 'redis';
import type { RecordStore } from './store';

export interface SessionStore extends RecordStore {
  close(): Promise<void>;
}

/** Session infrastructure only. This adapter has no domain/database access. */
export async function createSessionStore(
  url: string,
  connectTimeout: number,
): Promise<SessionStore> {
  const client = createClient({
    url,
    socket: {
      connectTimeout,
      socketTimeout: connectTimeout,
      reconnectStrategy: false,
    },
    commandOptions: { timeout: connectTimeout },
    disableOfflineQueue: true,
  });
  client.on('error', () => {
    /* Request path fails closed without logging credentials. */
  });
  let connecting: Promise<unknown> | undefined;
  async function ready() {
    if (!client.isReady) {
      connecting ??= client.connect().finally(() => {
        connecting = undefined;
      });
      await connecting;
    }
    return client;
  }
  await ready();
  return {
    close: async () => {
      await client.close();
    },
    get: async (key) => (await ready()).get(key),
    create: async (key, value, ttlMs) =>
      (await (await ready()).set(key, value, { NX: true, PX: ttlMs })) === 'OK',
    take: async (key) => (await ready()).getDel(key),
    remove: async (key) => {
      await (await ready()).del(key);
    },
    replace: async (key, expected, value, ttlMs) =>
      Number(
        await (
          await ready()
        ).eval(
          "if redis.call('GET',KEYS[1]) == ARGV[1] then redis.call('PSETEX',KEYS[1],ARGV[3],ARGV[2]); return 1 end; return 0",
          { keys: [key], arguments: [expected, value, String(ttlMs)] },
        ),
      ) === 1,
    removeIf: async (key, expected) => {
      await (
        await ready()
      ).eval(
        "if redis.call('GET',KEYS[1]) == ARGV[1] then return redis.call('DEL',KEYS[1]) end; return 0",
        { keys: [key], arguments: [expected] },
      );
    },
  };
}
