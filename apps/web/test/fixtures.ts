import type { WebEnvironment } from '../../../config/environment.mjs';
import type { RecordStore } from '../src/server/session/store';
import {
  SessionManager,
  type SessionPolicy,
} from '../src/server/session/manager';

export class MemoryStore implements RecordStore {
  readonly entries = new Map<string, { value: string; expires: number }>();

  private peek(key: string) {
    const item = this.entries.get(key);
    if (!item || item.expires <= Date.now()) {
      this.entries.delete(key);
      return null;
    }
    return item.value;
  }

  async get(key: string) {
    return this.peek(key);
  }

  async create(key: string, value: string, ttlMs: number) {
    if (this.peek(key)) {
      return false;
    }
    this.entries.set(key, { value, expires: Date.now() + ttlMs });
    return true;
  }

  async take(key: string) {
    const value = this.peek(key);
    this.entries.delete(key);
    return value;
  }

  async remove(key: string) {
    this.entries.delete(key);
  }

  async replace(key: string, expected: string, value: string, ttlMs: number) {
    if (this.peek(key) !== expected) {
      return false;
    }
    this.entries.set(key, { value, expires: Date.now() + ttlMs });
    return true;
  }

  async removeIf(key: string, expected: string) {
    if (this.peek(key) === expected) {
      this.entries.delete(key);
    }
  }
}

export const policy: SessionPolicy = {
  sessionTtlSeconds: 60,
  loginTtlSeconds: 30,
  refreshSkewSeconds: 1,
  lockMs: 1000,
  lockWaitMs: 2000,
  lockPollMs: 5,
};

export const secret = '12'.repeat(32);

export function fixtureConfig(): WebEnvironment {
  return {
    local: false,
    runtimeMode: 'm1-oidc',
    webHost: '127.0.0.1',
    webPort: 4310,
    publicOrigin: 'https://console.invalid',
    allowedOrigins: ['https://console.invalid'],
    apiOrigin: 'https://api.invalid',
    requestTimeoutMs: 1000,
    bodyLimitBytes: 1024,
    responseLimitBytes: 4096,
    docsRoot: 'docs',
    hosting: {
      publicOrigin: 'https://console.invalid',
      appId: 'unit',
      clientId: 'unit-app',
      callbackUri: 'https://console.invalid/auth/callback',
      logoutUri: 'https://console.invalid/auth/logged-out',
      cookieName: '__Host-unit-app-session',
      cookiePath: '/',
      cookieSecure: true,
      cookieHttpOnly: true,
      cookieSameSite: 'Lax',
      frameAncestors: "'none'",
    },
    auth: {
      ...policy,
      issuer: 'https://issuer.invalid/realms/unit',
      jwksUri: 'https://issuer.invalid/realms/unit/jwks',
      audience: 'unit-api',
      clientSecret: 'fixture-client-secret',
      scopes: ['openid', 'profile'],
      sessionSecret: secret,
      redisUrl: 'redis://127.0.0.1:1',
      redisConnectTimeoutMs: 50,
    },
  };
}

export function fixtureSessions(
  refresh: ConstructorParameters<typeof SessionManager>[4] = async () => {
    throw new Error('No refresh fixture.');
  },
) {
  const store = new MemoryStore();
  const manager = new SessionManager(
    store,
    secret,
    'unit-app',
    policy,
    refresh,
  );
  return { store, manager };
}

export const user = { name: 'Test operator', subject: 'operator-test' };
