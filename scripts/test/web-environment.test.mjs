import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadEnvironment,
  loadWebEnvironment,
} from '../../config/environment.mjs';
import { hostingContract } from '../../config/hosting.mjs';

test('BFF configuration is a web-only projection; no database password or alternate env gate', () => {
  loadWebEnvironment();
  const env = process.env;
  const previous = env.M0_DB_PASSWORD;
  try {
    delete env.M0_DB_PASSWORD;
    const config = loadWebEnvironment();
    assert.equal('database' in config, false);
    assert.equal('databaseUrl' in config, false);
  } finally {
    if (previous !== undefined) {
      env.M0_DB_PASSWORD = previous;
    }
  }
});
test('standalone origin/callback/cookie policy retires proxy authority and denies framing', () => {
  const input = {
    publicOrigin: 'https://runtime.invalid',
    appId: 'runtime',
    clientId: 'runtime-app',
    callbackUri: 'https://runtime.invalid/auth/callback',
    logoutUri: 'https://runtime.invalid/auth/logged-out',
  };
  const hosting = hostingContract(input);
  assert.equal(hosting.cookiePath, '/');
  assert.match(hosting.cookieName, /^__Host-/);
  assert.equal(hosting.frameAncestors, "'none'");
  assert.equal('proxySecret' in hosting, false);
  assert.equal('clientSecret' in hosting, false);
  assert.throws(() =>
    hostingContract({ ...input, publicOrigin: 'http://runtime.invalid' }),
  );
  assert.throws(() =>
    hostingContract({
      ...input,
      callbackUri: 'https://runtime.invalid/apps/runtime/app/auth/callback',
    }),
  );
});
test('API configuration does not require confidential web secrets; BFF fails closed without them', () => {
  loadEnvironment();
  const env = process.env;
  const prior = { ...env };
  try {
    Object.assign(env, {
      M0_RUNTIME_MODE: 'm1-oidc',
      M1_PUBLIC_ORIGIN: 'https://runtime.invalid',
      M1_APP_ID: 'runtime',
      M1_OIDC_CLIENT_ID: 'runtime-app',
      M1_OIDC_CALLBACK_URI: 'https://runtime.invalid/auth/callback',
      M1_OIDC_LOGOUT_URI: 'https://runtime.invalid/auth/logged-out',
      M1_OIDC_ISSUER: 'https://issuer.invalid/realms/unit',
      M1_OIDC_AUDIENCE: 'runtime-api',
      M1_OIDC_JWKS_URI: 'https://issuer.invalid/jwks',
      M1_API_ORIGIN: 'http://api.internal:4311',
      M1_OIDC_CLIENT_SECRET: '',
      M1_SESSION_SECRET: '',
    });
    const api = loadEnvironment();
    assert.equal(api.oidc.operatorClientId, 'runtime-app');
    assert.equal('clientSecret' in api.hosting, false);
    assert.throws(() => loadWebEnvironment(), /M1_SESSION_SECRET/);
  } finally {
    for (const key of Object.keys(env)) {
      if (!(key in prior)) {
        delete env[key];
      }
    }
    Object.assign(env, prior);
  }
});
