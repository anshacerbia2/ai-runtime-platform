import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import type {
  ApplicationRegistry,
  PrincipalVerifier,
} from '../application/principal-verifier.port.js';
import type { Principal } from '../domain/principal.js';

export interface OidcVerifierOptions {
  issuer: string;
  audience: string;
  jwksUri: string;
  operatorClientId: string;
  runnerClientId?: string;
}
export class OidcVerifier implements PrincipalVerifier {
  private readonly keys: JWTVerifyGetKey;
  constructor(
    private readonly options: OidcVerifierOptions,
    private readonly registry: ApplicationRegistry,
    keys?: JWTVerifyGetKey,
  ) {
    for (const value of [options.issuer, options.jwksUri]) {
      const url = new URL(value);
      if (
        url.protocol !== 'https:' ||
        url.username ||
        url.password ||
        url.hash
      ) {
        throw new Error('OIDC endpoints require HTTPS.');
      }
    }
    if (
      new URL(options.issuer).origin !== new URL(options.jwksUri).origin ||
      !options.audience
    ) {
      throw new Error('OIDC JWKS must belong to the configured issuer origin.');
    }
    this.keys =
      keys ??
      createRemoteJWKSet(new URL(options.jwksUri), {
        timeoutDuration: 5000,
        cooldownDuration: 30000,
        cacheMaxAge: 300000,
      });
  }
  async verify(token: string): Promise<Principal | null> {
    let payload;
    try {
      ({ payload } = await jwtVerify(token, this.keys, {
        issuer: this.options.issuer,
        audience: this.options.audience,
        algorithms: ['RS256'],
        requiredClaims: ['iss', 'aud', 'sub', 'exp', 'iat', 'azp'],
        clockTolerance: 0,
        maxTokenAge: '1h',
      }));
    } catch {
      return null;
    }
    if (
      payload.typ !== 'Bearer' ||
      typeof payload.sub !== 'string' ||
      !payload.sub ||
      typeof payload.azp !== 'string' ||
      typeof payload.scope !== 'string'
    ) {
      return null;
    }
    const access = payload.resource_access as
      Record<string, { roles?: unknown }> | undefined;
    const claimed = access?.[this.options.audience]?.roles;
    if (
      !Array.isArray(claimed) ||
      !claimed.every((role): role is string => typeof role === 'string')
    ) {
      return null;
    }
    const roles = claimed;
    const scopes = payload.scope.split(' ').filter(Boolean);
    const base = { subject: payload.sub, roles, scopes };
    // Role ambiguity is rejected; an application cannot turn into an operator.
    const operator = roles.some((role) =>
      ['platform-operator', 'platform-admin', 'platform-accountant'].includes(
        role,
      ),
    );
    const app = roles.includes('runtime-application');
    const runner = roles.includes('runtime-runner');
    if (Number(operator) + Number(app) + Number(runner) !== 1) {
      return null;
    }
    if (operator) {
      return payload.azp === this.options.operatorClientId
        ? { ...base, kind: 'operator' }
        : null;
    }
    if (runner) {
      return payload.azp === this.options.runnerClientId
        ? { ...base, kind: 'runner' }
        : null;
    }
    const applicationId = await this.registry.resolveClient(payload.azp);
    return applicationId
      ? { ...base, kind: 'application', applicationId }
      : null;
  }
}
