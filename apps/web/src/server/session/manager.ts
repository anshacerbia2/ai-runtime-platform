import 'server-only';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { RecordStore } from './store';
import { sessionCrypto } from './crypto';

export interface SessionUser {
  subject: string;
  name: string;
}

export interface Tokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
}

export interface SessionRecord extends Tokens {
  user: SessionUser;
  expires: number;
}

export interface LoginRecord {
  state: string;
  nonce: string;
  verifier: string;
  returnTo: string;
  expires: number;
}

export interface SessionPolicy {
  sessionTtlSeconds: number;
  loginTtlSeconds: number;
  refreshSkewSeconds: number;
  lockMs: number;
  lockWaitMs: number;
  lockPollMs: number;
}

export class SessionManager {
  private readonly crypto;

  constructor(
    private readonly store: RecordStore,
    secret: string,
    private readonly namespace: string,
    private readonly policy: SessionPolicy,
    private readonly refresh: (tokens: SessionRecord) => Promise<Tokens>,
  ) {
    this.crypto = sessionCrypto(secret, namespace);
  }

  private key(kind: string, reference: string) {
    return this.namespace + ':' + kind + ':' + reference.split('.')[0];
  }

  async create(tokens: Tokens, user: SessionUser): Promise<string> {
    const reference = this.crypto.reference();
    const ttl = this.policy.sessionTtlSeconds * 1000;
    const value: SessionRecord = { ...tokens, user, expires: Date.now() + ttl };
    if (
      !(await this.store.create(
        this.key('session', reference),
        this.crypto.seal(value),
        ttl,
      ))
    ) {
      throw new Error('Session collision.');
    }
    return reference;
  }

  async login(value: Omit<LoginRecord, 'expires'>): Promise<string> {
    const reference = this.crypto.reference();
    const ttl = this.policy.loginTtlSeconds * 1000;
    if (
      !(await this.store.create(
        this.key('login', reference),
        this.crypto.seal({ ...value, expires: Date.now() + ttl }),
        ttl,
      ))
    ) {
      throw new Error('Login collision.');
    }
    return reference;
  }

  async consumeLogin(reference: string): Promise<LoginRecord | null> {
    if (!this.crypto.verify(reference)) {
      return null;
    }
    const raw = await this.store.take(this.key('login', reference));
    if (!raw) {
      return null;
    }
    try {
      const flow = this.crypto.open<LoginRecord>(raw);
      return flow.expires > Date.now() ? flow : null;
    } catch {
      return null;
    }
  }

  async read(reference: string): Promise<SessionRecord | null> {
    if (!this.crypto.verify(reference)) {
      return null;
    }
    const raw = await this.store.get(this.key('session', reference));
    if (!raw) {
      return null;
    }
    try {
      const value = this.crypto.open<SessionRecord>(raw);
      return value.expires > Date.now() &&
        typeof value.accessToken === 'string' &&
        typeof value.user.subject === 'string'
        ? value
        : null;
    } catch {
      return null;
    }
  }

  async logout(reference: string): Promise<void> {
    if (this.crypto.verify(reference)) {
      await this.store.remove(this.key('session', reference));
    }
  }

  async access(reference: string): Promise<string | null> {
    let session = await this.read(reference);
    if (!session) {
      return null;
    }
    const fresh = (value: SessionRecord) =>
      value.expiresAt > Date.now() + this.policy.refreshSkewSeconds * 1000;
    if (fresh(session)) {
      return session.accessToken;
    }
    const key = this.key('session', reference);
    const owner = randomUUID();
    const lock = key + ':lock';
    const deadline = Date.now() + this.policy.lockWaitMs;
    while (!(await this.store.create(lock, owner, this.policy.lockMs))) {
      if (Date.now() >= deadline) {
        throw new Error('Session refresh busy.');
      }
      await delay(this.policy.lockPollMs);
      session = await this.read(reference);
      if (!session) {
        return null;
      }
      if (fresh(session)) {
        return session.accessToken;
      }
    }
    try {
      const raw = await this.store.get(key);
      if (!raw) {
        return null;
      }
      session = this.crypto.open<SessionRecord>(raw);
      if (session.expires <= Date.now()) {
        await this.store.removeIf(key, raw);
        return null;
      }
      if (fresh(session)) {
        return session.accessToken;
      }
      if (!session.refreshToken) {
        await this.store.removeIf(key, raw);
        return null;
      }
      try {
        const tokens = await this.refresh(session);
        if (
          !tokens.accessToken ||
          !Number.isFinite(tokens.expiresAt) ||
          tokens.expiresAt <= Date.now()
        ) {
          throw new Error('Invalid refresh.');
        }
        const ttl = session.expires - Date.now();
        if (ttl <= 0) {
          await this.store.removeIf(key, raw);
          return null;
        }
        // CAS cannot revive a logged-out session or overwrite a newer refresh.
        const next = this.crypto.seal({ ...session, ...tokens });
        return (await this.store.replace(key, raw, next, ttl))
          ? tokens.accessToken
          : null;
      } catch {
        await this.store.removeIf(key, raw);
        return null;
      }
    } finally {
      await this.store.removeIf(lock, owner);
    }
  }
}
