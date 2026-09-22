import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import type { CustomFetch } from 'openid-client';
import { createIdentityClient } from '../src/server/auth/oidc';
import { login, callback, logout } from '../src/server/auth/handlers';
import { fixtureConfig, fixtureSessions } from './fixtures';

function issuerFixture(mode = 'valid') {
  const config = fixtureConfig();
  const issuer = config.auth!.issuer;
  const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = {
    ...keys.publicKey.export({ format: 'jwk' }),
    kid: 'fixture-key',
    use: 'sig',
    alg: 'RS256',
  };
  let nonce = '';
  let challenge = '';
  let tokenCalls = 0;
  const jwt = () => {
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iss: mode === 'issuer' ? issuer + '-wrong' : issuer,
      aud: mode === 'audience' ? 'wrong-client' : config.hosting!.clientId,
      sub: 'operator-test',
      preferred_username: 'Test operator',
      iat: now,
      exp: mode === 'expired' ? now - 60 : now + 300,
      nonce: mode === 'nonce' ? 'wrong-nonce' : nonce,
    };
    const value =
      Buffer.from(
        JSON.stringify({ alg: 'RS256', kid: 'fixture-key' }),
      ).toString('base64url') +
      '.' +
      Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = sign(
      'RSA-SHA256',
      Buffer.from(value),
      keys.privateKey,
    ).toString('base64url');
    return value + '.' + (mode === 'signature' ? 'invalid' : signature);
  };
  const transport: CustomFetch = async (input, options) => {
    const url = String(input);
    if (url === issuer + '/.well-known/openid-configuration') {
      return Response.json({
        issuer,
        authorization_endpoint: issuer + '/authorize',
        token_endpoint: issuer + '/token',
        jwks_uri: config.auth!.jwksUri,
        response_types_supported: ['code'],
        subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['RS256'],
        token_endpoint_auth_methods_supported: ['client_secret_post'],
        code_challenge_methods_supported: ['S256'],
      });
    }
    if (url === config.auth!.jwksUri) {
      return Response.json({ keys: [jwk] });
    }
    assert.equal(url, issuer + '/token');
    tokenCalls++;
    const params = new URLSearchParams(String(options.body));
    assert.equal(params.get('client_secret'), config.auth!.clientSecret);
    if (params.get('grant_type') === 'authorization_code') {
      assert.equal(params.get('redirect_uri'), config.hosting!.callbackUri);
      assert.equal(
        createHash('sha256')
          .update(params.get('code_verifier')!)
          .digest('base64url'),
        challenge,
      );
    }
    return Response.json({
      access_token: 'fixture-access-token',
      refresh_token: 'fixture-refresh-token',
      token_type: 'Bearer',
      expires_in: 300,
      id_token: jwt(),
    });
  };
  const client = createIdentityClient(config, transport);
  return {
    config,
    client,
    calls: () => tokenCalls,
    async authorize() {
      const result = await client.authorize('/control-plane');
      const url = new URL(result.url);
      nonce = url.searchParams.get('nonce')!;
      challenge = url.searchParams.get('code_challenge')!;
      assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
      assert.equal(url.searchParams.get('response_type'), 'code');
      return result;
    },
  };
}

test('G36 real OIDC library verifies code/state/PKCE/nonce/signature and refreshes using server transport', async () => {
  const f = issuerFixture();
  const { flow } = await f.authorize();
  const url = new URL(
    f.config.hosting!.callbackUri + '?code=fixture-code&state=' + flow.state,
  );
  const result = await f.client.exchange(url, {
    ...flow,
    expires: Date.now() + 10000,
  });
  assert.equal(result.user.subject, 'operator-test');
  assert.equal(result.tokens.accessToken, 'fixture-access-token');
  const refreshed = await f.client.refresh({
    ...result.tokens,
    user: result.user,
    expires: Date.now() + 10000,
  });
  assert.equal(refreshed.refreshToken, 'fixture-refresh-token');
  assert.equal(f.calls(), 2);
});

test('G36 a mismatched state is rejected before token exchange', async () => {
  const f = issuerFixture();
  const { flow } = await f.authorize();
  await assert.rejects(() =>
    f.client.exchange(
      new URL(f.config.hosting!.callbackUri + '?code=fixture-code&state=wrong'),
      { ...flow, expires: Date.now() + 10000 },
    ),
  );
  assert.equal(f.calls(), 0);
});

for (const mode of ['nonce', 'issuer', 'audience', 'expired', 'signature']) {
  test('G36 rejects invalid ID token ' + mode, async () => {
    const f = issuerFixture(mode);
    const { flow } = await f.authorize();
    await assert.rejects(() =>
      f.client.exchange(
        new URL(
          f.config.hosting!.callbackUri +
            '?code=fixture-code&state=' +
            flow.state,
        ),
        { ...flow, expires: Date.now() + 10000 },
      ),
    );
  });
}

test('G36/G37 full handler flow rotates cookie, rejects callback replay, and locally logs out without realm logout', async () => {
  const f = issuerFixture();
  const { manager } = fixtureSessions((session) => f.client.refresh(session));
  // Wrap authorize only to record the expected nonce/challenge in the synthetic issuer.
  const runtime = {
    config: f.config,
    identity: { ...f.client, authorize: () => f.authorize() },
    sessions: manager,
  };
  const response = await login(
    new Request('https://console.invalid/auth/login', {
      method: 'POST',
      headers: { Origin: 'https://console.invalid' },
    }),
    runtime,
  );
  assert.equal(response.status, 303);
  const flowCookie = response.headers.getSetCookie()[0].split(';')[0];
  const authorization = new URL(response.headers.get('Location')!);
  const callbackRequest = new Request(
    f.config.hosting!.callbackUri +
      '?code=fixture-code&state=' +
      authorization.searchParams.get('state'),
    { headers: { Cookie: flowCookie } },
  );
  const signedIn = await callback(callbackRequest, runtime);
  assert.equal(
    signedIn.headers.get('Location'),
    'https://console.invalid/control-plane',
  );
  const sessionCookie = signedIn.headers
    .getSetCookie()
    .find((value) => value.startsWith(f.config.hosting!.cookieName + '='))!;
  assert.match(sessionCookie, /HttpOnly; Secure; SameSite=Lax/);
  assert.equal(sessionCookie.includes('fixture-access'), false);
  const replay = await callback(callbackRequest, runtime);
  assert.equal(
    replay.headers.get('Location'),
    'https://console.invalid/?signIn=failed',
  );
  const ended = await logout(
    new Request('https://console.invalid/auth/logout', {
      method: 'POST',
      headers: {
        Origin: 'https://console.invalid',
        Cookie: sessionCookie.split(';')[0],
      },
    }),
    runtime,
  );
  assert.equal(ended.headers.get('Location'), f.config.hosting!.logoutUri);
  assert.match(ended.headers.getSetCookie()[0], /Max-Age=0/);
  assert.equal(f.calls(), 1);
});
