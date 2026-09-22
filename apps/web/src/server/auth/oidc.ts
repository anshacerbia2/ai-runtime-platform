import 'server-only';
import * as oidc from 'openid-client';
import type { WebEnvironment } from '../../../../../config/environment.mjs';
import type {
  LoginRecord,
  SessionRecord,
  SessionUser,
  Tokens,
} from '../session/manager';

export interface IdentityClient {
  authorize(
    returnTo: string,
  ): Promise<{ url: string; flow: Omit<LoginRecord, 'expires'> }>;
  exchange(
    url: URL,
    flow: LoginRecord,
  ): Promise<{ tokens: Tokens; user: SessionUser }>;
  refresh(session: SessionRecord): Promise<Tokens>;
}

/** Optional transport exists solely for unit fixtures; never selected by env. */
export function createIdentityClient(
  config: WebEnvironment,
  transport?: oidc.CustomFetch,
): IdentityClient {
  const auth = config.auth;
  const hosting = config.hosting;
  if (!auth || !hosting) {
    throw new Error('OIDC is not configured.');
  }
  let configuration: Promise<oidc.Configuration> | undefined;
  async function discover() {
    if (!configuration) {
      configuration = oidc
        .discovery(
          new URL(auth!.issuer),
          hosting!.clientId,
          {
            client_secret: auth!.clientSecret,
            id_token_signed_response_alg: 'RS256',
          },
          oidc.ClientSecretPost(auth!.clientSecret),
          {
            timeout: config.requestTimeoutMs / 1000,
            execute: [oidc.enableNonRepudiationChecks],
            ...(transport ? { [oidc.customFetch]: transport } : {}),
          },
        )
        .then((client) => {
          const metadata = client.serverMetadata();
          if (metadata.jwks_uri !== auth!.jwksUri) {
            throw new Error('Unexpected issuer JWKS.');
          }
          for (const value of [
            metadata.authorization_endpoint,
            metadata.token_endpoint,
            metadata.jwks_uri,
          ]) {
            if (typeof value !== 'string') {
              throw new Error('Incomplete discovery.');
            }
            const endpoint = new URL(value);
            if (
              endpoint.protocol !== 'https:' ||
              endpoint.origin !== new URL(auth!.issuer).origin ||
              endpoint.username ||
              endpoint.password ||
              endpoint.hash
            ) {
              throw new Error('Untrusted discovery endpoint.');
            }
          }
          return client;
        })
        .catch((error: unknown) => {
          configuration = undefined;
          throw error;
        });
    }
    return configuration;
  }
  function tokenSet(
    tokens: oidc.TokenEndpointResponse,
    previous?: SessionRecord,
  ): Tokens {
    if (
      typeof tokens.access_token !== 'string' ||
      !tokens.access_token ||
      typeof tokens.expires_in !== 'number' ||
      !Number.isFinite(tokens.expires_in) ||
      tokens.expires_in <= auth!.refreshSkewSeconds
    ) {
      throw new Error('A bounded access token lifetime is required.');
    }
    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? previous?.refreshToken,
      expiresAt: Date.now() + tokens.expires_in * 1000,
    };
  }
  return {
    async authorize(returnTo) {
      const client = await discover();
      const state = oidc.randomState();
      const nonce = oidc.randomNonce();
      const verifier = oidc.randomPKCECodeVerifier();
      const challenge = await oidc.calculatePKCECodeChallenge(verifier);
      const url = oidc.buildAuthorizationUrl(client, {
        redirect_uri: hosting.callbackUri,
        scope: auth.scopes.join(' '),
        response_type: 'code',
        state,
        nonce,
        code_challenge: challenge,
        code_challenge_method: 'S256',
      });
      return { url: url.href, flow: { state, nonce, verifier, returnTo } };
    },
    async exchange(url, flow) {
      const tokens = await oidc.authorizationCodeGrant(await discover(), url, {
        expectedState: flow.state,
        expectedNonce: flow.nonce,
        pkceCodeVerifier: flow.verifier,
        idTokenExpected: true,
      });
      const claims = tokens.claims();
      if (!claims?.sub) {
        throw new Error('OIDC subject is missing.');
      }
      return {
        tokens: tokenSet(tokens),
        user: {
          subject: claims.sub,
          name:
            typeof claims.preferred_username === 'string'
              ? claims.preferred_username
              : claims.sub,
        },
      };
    },
    async refresh(session) {
      if (!session.refreshToken) {
        throw new Error('Refresh token is missing.');
      }
      const tokens = await oidc.refreshTokenGrant(
        await discover(),
        session.refreshToken,
      );
      const claims = tokens.claims();
      if (claims && claims.sub !== session.user.subject) {
        throw new Error('Refresh changed subject.');
      }
      return tokenSet(tokens, session);
    },
  };
}
