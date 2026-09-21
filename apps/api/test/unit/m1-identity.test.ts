import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateKeyPair,
  exportJWK,
  SignJWT,
  createRemoteJWKSet,
  customFetch,
} from 'jose';
import { OidcVerifier } from '../../src/modules/identity/infrastructure/oidc-verifier.js';
import { LocalPrincipalVerifier } from '../../src/modules/identity/infrastructure/local-principal-verifier.js';
import { requireAuthority } from '../../src/modules/identity/domain/principal.js';

test('G01/G26 OIDC signature, issuer, audience, expiry, azp and authority separation with local JWKS transport', async () => {
  const pair = await generateKeyPair('RS256');
  const other = await generateKeyPair('RS256');
  const options = {
    issuer: 'https://identity.example/realms/test',
    audience: 'runtime-api',
    jwksUri: 'https://identity.example/realms/test/certs',
    operatorClientId: 'operator-ui',
    runnerClientId: 'runner-client',
  };
  let fetches = 0;
  let jwks = {
    keys: [{ ...(await exportJWK(pair.publicKey)), kid: 'one', alg: 'RS256' }],
  };
  const keys = createRemoteJWKSet(new URL(options.jwksUri), {
    cooldownDuration: 0,
    [customFetch]: async () => {
      fetches++;
      return new Response(JSON.stringify(jwks), { status: 200 });
    },
  });
  let enabled = true;
  const verifier = new OidcVerifier(
    options,
    {
      resolveClient: async (client) =>
        enabled && client === 'app-client' ? 'app-a' : null,
    },
    keys,
  );
  const claims = {
    typ: 'Bearer',
    sub: 'subject',
    azp: 'app-client',
    scope: 'execution:submit execution:read',
    resource_access: { 'runtime-api': { roles: ['runtime-application'] } },
  };
  const sign = (
    overrides: Record<string, unknown> = {},
    key = pair.privateKey,
    kid = 'one',
  ) =>
    new SignJWT({ ...claims, ...overrides })
      .setProtectedHeader({ alg: 'RS256', kid })
      .setIssuer(options.issuer)
      .setAudience(options.audience)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(key);
  const app = await verifier.verify(await sign());
  assert.equal(app?.applicationId, 'app-a');
  assert.throws(() =>
    requireAuthority(
      { ...app!, scopes: ['platform:manage'], roles: ['platform-admin'] },
      'platform:manage',
    ),
  );
  await verifier.verify(await sign());
  assert.equal(fetches, 1, 'JWKS is cached');
  for (const overrides of [
    { azp: 'unknown-client' },
    { typ: 'ID' },
    { sub: '' },
    { scope: null },
    {
      resource_access: {
        'runtime-api': { roles: ['runtime-application', 'platform-admin'] },
      },
    },
    { resource_access: { 'runtime-api': { roles: ['platform-admin'] } } },
  ]) {
    assert.equal(await verifier.verify(await sign(overrides)), null);
  }
  for (const jwt of [
    new SignJWT(claims)
      .setIssuer('https://wrong.example')
      .setAudience(options.audience)
      .setIssuedAt()
      .setExpirationTime('5m'),
    new SignJWT(claims)
      .setIssuer(options.issuer)
      .setAudience('wrong')
      .setIssuedAt()
      .setExpirationTime('5m'),
    new SignJWT(claims)
      .setIssuer(options.issuer)
      .setAudience(options.audience)
      .setIssuedAt()
      .setExpirationTime(1),
    new SignJWT(claims)
      .setIssuer(options.issuer)
      .setAudience(options.audience)
      .setIssuedAt()
      .setExpirationTime('5m')
      .setNotBefore('5m'),
  ]) {
    assert.equal(
      await verifier.verify(
        await jwt
          .setProtectedHeader({ alg: 'RS256', kid: 'one' })
          .sign(pair.privateKey),
      ),
      null,
    );
  }
  assert.equal(await verifier.verify(await sign({}, other.privateKey)), null);
  enabled = false;
  assert.equal(await verifier.verify(await sign()), null);
  const operator = await verifier.verify(
    await sign({
      azp: 'operator-ui',
      scope: 'platform:manage',
      resource_access: { 'runtime-api': { roles: ['platform-admin'] } },
    }),
  );
  requireAuthority(operator!, 'platform:manage');
  assert.throws(() => requireAuthority(operator!, 'execution:submit'));
  const runner = await verifier.verify(
    await sign({
      azp: 'runner-client',
      scope: 'runner:register',
      resource_access: { 'runtime-api': { roles: ['runtime-runner'] } },
    }),
  );
  requireAuthority(runner!, 'runner:register');
  jwks = {
    keys: [{ ...(await exportJWK(other.publicKey)), kid: 'two', alg: 'RS256' }],
  };
  enabled = true;
  assert.equal(
    (await verifier.verify(await sign({}, other.privateKey, 'two')))
      ?.applicationId,
    'app-a',
  );
  assert.equal(fetches, 2, 'key rotation refreshes JWKS');
  assert.throws(
    () =>
      new OidcVerifier(
        { ...options, jwksUri: 'http://identity.example/certs' },
        { resolveClient: async () => null },
      ),
  );
});

test('local application, operator and runner principals use the same authority policy', async () => {
  const verifier = new LocalPrincipalVerifier(
    {
      verify: async (token) =>
        token === 'application' ? { applicationId: 'app' } : null,
    },
    'operator',
    'runner',
  );
  assert.equal((await verifier.verify('application'))?.kind, 'application');
  requireAuthority((await verifier.verify('operator'))!, 'platform:manage');
  requireAuthority((await verifier.verify('runner'))!, 'runner:register');
  assert.equal(await verifier.verify('invalid'), null);
  assert.throws(() =>
    requireAuthority(
      {
        kind: 'operator',
        subject: 'accountant',
        roles: ['platform-accountant'],
        scopes: ['platform:manage'],
      },
      'platform:manage',
    ),
  );
});
