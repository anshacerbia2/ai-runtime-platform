import 'server-only';
import {
  loadWebEnvironment,
  type WebEnvironment,
} from '../../../../config/environment.mjs';
import { createIdentityClient, type IdentityClient } from './auth/oidc';
import { createSessionStore } from './session/redis-store';
import { SessionManager } from './session/manager';

export interface WebRuntime {
  config: WebEnvironment;
  identity?: IdentityClient;
  sessions?: SessionManager;
}

const globalRuntime = globalThis as typeof globalThis & {
  runtimeBff?: Promise<WebRuntime>;
};

export function webConfig() {
  return loadWebEnvironment();
}

export async function webRuntime(): Promise<WebRuntime> {
  if (!globalRuntime.runtimeBff) {
    globalRuntime.runtimeBff = (async () => {
      const config = webConfig();
      if (config.local) {
        return { config };
      }
      if (!config.auth || !config.hosting) {
        throw new Error('Missing OIDC configuration.');
      }
      const identity = createIdentityClient(config);
      const store = await createSessionStore(
        config.auth.redisUrl,
        config.auth.redisConnectTimeoutMs,
      );
      const sessions = new SessionManager(
        store,
        config.auth.sessionSecret,
        config.hosting.clientId,
        config.auth,
        (value) => identity.refresh(value),
      );
      return { config, identity, sessions };
    })().catch((error: unknown) => {
      globalRuntime.runtimeBff = undefined;
      throw error;
    });
  }
  return globalRuntime.runtimeBff;
}
