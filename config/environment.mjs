import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from 'node:process';
import { z } from 'zod';
import { hostingContract } from './hosting.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envFile = resolve(root, '.env');
let loaded = false;

function loadDotEnv() {
  if (loaded) {
    return;
  }
  loaded = true;
  if (existsSync(envFile)) {
    loadEnvFile(envFile);
  }
}

// ---------------------------------------------------------------------------
// Reusable Schema Building Blocks
// ---------------------------------------------------------------------------

function parseWithSchema(schema, data) {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new Error(result.error.issues[0].message);
  }
  return result.data;
}

const reqStr = (name) =>
  z
    .string({ message: `Missing required environment variable: ${name}` })
    .trim()
    .min(1, { message: `Missing required environment variable: ${name}` });

const optStr = () =>
  z.preprocess((v) => {
    if (typeof v === 'string') {
      const trimmed = v.trim();
      return trimmed === '' ? undefined : trimmed;
    }
    return undefined;
  }, z.string().optional());

const intEnv = (name, minimum = 1) =>
  reqStr(name)
    .refine(
      (v) => {
        const num = Number(v);
        return Number.isInteger(num) && num >= minimum;
      },
      { message: `${name} must be an integer >= ${minimum}.` },
    )
    .transform((v) => Number(v));

const boolEnv = (name) =>
  reqStr(name)
    .refine((v) => v === 'true' || v === 'false', {
      message: `${name} must be exactly true or false.`,
    })
    .transform((v) => v === 'true');

const listEnv = (name) =>
  reqStr(name)
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    )
    .refine((arr) => arr.length > 0, {
      message: `${name} must contain at least one value.`,
    });

function assertLoopback(host, label) {
  if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host)) {
    throw new Error(`${label} must use a loopback host for M0.`);
  }
}

function databaseUrl(db) {
  const url = new URL('postgresql://localhost');
  url.username = db.user;
  url.password = db.password;
  url.hostname = db.host;
  url.port = String(db.port);
  url.pathname = `/${db.name}`;
  return url.toString();
}

// ---------------------------------------------------------------------------
// Level 3 Schema Definitions
// ---------------------------------------------------------------------------

export const runtimeEnvironmentSchema = z.object({
  M0_RUNTIME_MODE: z.enum(['m0-local', 'm1-oidc'], {
    message: 'M0_RUNTIME_MODE must be m0-local or m1-oidc.',
  }),
  M0_API_HOST: reqStr('M0_API_HOST'),
  M0_API_PORT: intEnv('M0_API_PORT'),
  M0_WEB_HOST: reqStr('M0_WEB_HOST'),
  M0_WEB_PORT: intEnv('M0_WEB_PORT'),
  M0_ALLOWED_HOSTS: listEnv('M0_ALLOWED_HOSTS'),
  M0_ALLOWED_ORIGINS: listEnv('M0_ALLOWED_ORIGINS'),
  M0_API_BODY_LIMIT_BYTES: intEnv('M0_API_BODY_LIMIT_BYTES'),
  M0_API_REQUEST_TIMEOUT_MS: intEnv('M0_API_REQUEST_TIMEOUT_MS'),
  M0_DB_HOST: reqStr('M0_DB_HOST'),
  M0_DB_PORT: intEnv('M0_DB_PORT'),
  M0_DB_NAME: reqStr('M0_DB_NAME'),
  M0_DB_USER: reqStr('M0_DB_USER'),
  M0_DB_PASSWORD: reqStr('M0_DB_PASSWORD'),
  M0_MANAGE_POSTGRES: boolEnv('M0_MANAGE_POSTGRES'),
  PG_BIN: reqStr('PG_BIN'),
  M0_POSTGRES_DATA_DIR: reqStr('M0_POSTGRES_DATA_DIR'),
  M0_POSTGRES_LOG_FILE: reqStr('M0_POSTGRES_LOG_FILE'),
  M0_DB_POOL_MAX: intEnv('M0_DB_POOL_MAX'),
  M0_DB_CONNECTION_TIMEOUT_MS: intEnv('M0_DB_CONNECTION_TIMEOUT_MS'),
  M0_DB_IDLE_TIMEOUT_MS: intEnv('M0_DB_IDLE_TIMEOUT_MS'),
  M0_DB_STATEMENT_TIMEOUT_MS: intEnv('M0_DB_STATEMENT_TIMEOUT_MS'),
  M0_DB_APPLICATION_NAME: reqStr('M0_DB_APPLICATION_NAME'),
  M0_SEED_TX_MAX_WAIT_MS: intEnv('M0_SEED_TX_MAX_WAIT_MS'),
  M0_SEED_TX_TIMEOUT_MS: intEnv('M0_SEED_TX_TIMEOUT_MS'),
  M0_DEV_API_READY_TIMEOUT_MS: intEnv('M0_DEV_API_READY_TIMEOUT_MS'),
  M0_DEV_API_PROBE_TIMEOUT_MS: intEnv('M0_DEV_API_PROBE_TIMEOUT_MS'),
  M0_DEV_API_POLL_INTERVAL_MS: intEnv('M0_DEV_API_POLL_INTERVAL_MS'),
  M0_DEV_CHILD_STOP_TIMEOUT_MS: intEnv('M0_DEV_CHILD_STOP_TIMEOUT_MS'),
  M0_POSTGRES_START_TIMEOUT_SECONDS: intEnv('M0_POSTGRES_START_TIMEOUT_SECONDS'),
  M0_APP_ID: reqStr('M0_APP_ID'),
  M0_APP_NAME: reqStr('M0_APP_NAME'),
  M0_APP_TOKEN: reqStr('M0_APP_TOKEN'),
  M0_TEST_APP_ID: reqStr('M0_TEST_APP_ID'),
  M0_TEST_APP_NAME: reqStr('M0_TEST_APP_NAME'),
  M0_TEST_APP_TOKEN: reqStr('M0_TEST_APP_TOKEN'),
  M2_OPENROUTER_API_KEY: optStr(),
  M2_ANTHROPIC_API_KEY: optStr(),
  PLAYWRIGHT_BROWSER_NAME: reqStr('PLAYWRIGHT_BROWSER_NAME'),
  PLAYWRIGHT_CHANNEL: reqStr('PLAYWRIGHT_CHANNEL'),
  PLAYWRIGHT_TEST_TIMEOUT_MS: intEnv('PLAYWRIGHT_TEST_TIMEOUT_MS'),
  PLAYWRIGHT_WEB_SERVER_TIMEOUT_MS: intEnv('PLAYWRIGHT_WEB_SERVER_TIMEOUT_MS'),
  PLAYWRIGHT_VIEWPORT_WIDTH: intEnv('PLAYWRIGHT_VIEWPORT_WIDTH'),
  PLAYWRIGHT_VIEWPORT_HEIGHT: intEnv('PLAYWRIGHT_VIEWPORT_HEIGHT'),
  PLAYWRIGHT_REUSE_EXISTING_SERVER: boolEnv('PLAYWRIGHT_REUSE_EXISTING_SERVER'),
  M1_LOCAL_OPERATOR_TOKEN: optStr(),
  M1_LOCAL_RUNNER_TOKEN: optStr(),
  M1_PUBLIC_ORIGIN: optStr(),
  M1_APP_ID: optStr(),
  M1_OIDC_CLIENT_ID: optStr(),
  M1_OIDC_CALLBACK_URI: optStr(),
  M1_OIDC_LOGOUT_URI: optStr(),
  M1_OIDC_ISSUER: optStr(),
  M1_OIDC_AUDIENCE: optStr(),
  M1_OIDC_JWKS_URI: optStr(),
  M1_OIDC_RUNNER_CLIENT_ID: optStr(),
});

export function loadEnvironment() {
  loadDotEnv();
  const raw = parseWithSchema(runtimeEnvironmentSchema, process.env);

  const config = {
    runtimeMode: raw.M0_RUNTIME_MODE,
    apiHost: raw.M0_API_HOST,
    apiPort: raw.M0_API_PORT,
    webHost: raw.M0_WEB_HOST,
    webPort: raw.M0_WEB_PORT,
    allowedHosts: raw.M0_ALLOWED_HOSTS,
    allowedOrigins: raw.M0_ALLOWED_ORIGINS,
    apiBodyLimitBytes: raw.M0_API_BODY_LIMIT_BYTES,
    apiRequestTimeoutMs: raw.M0_API_REQUEST_TIMEOUT_MS,
    database: {
      host: raw.M0_DB_HOST,
      port: raw.M0_DB_PORT,
      name: raw.M0_DB_NAME,
      user: raw.M0_DB_USER,
      password: raw.M0_DB_PASSWORD,
      managePostgres: raw.M0_MANAGE_POSTGRES,
      pgBin: raw.PG_BIN,
      dataDir: raw.M0_POSTGRES_DATA_DIR,
      logFile: raw.M0_POSTGRES_LOG_FILE,
      poolMax: raw.M0_DB_POOL_MAX,
      connectionTimeoutMs: raw.M0_DB_CONNECTION_TIMEOUT_MS,
      idleTimeoutMs: raw.M0_DB_IDLE_TIMEOUT_MS,
      statementTimeoutMs: raw.M0_DB_STATEMENT_TIMEOUT_MS,
      applicationName: raw.M0_DB_APPLICATION_NAME,
    },
    seedTxMaxWaitMs: raw.M0_SEED_TX_MAX_WAIT_MS,
    seedTxTimeoutMs: raw.M0_SEED_TX_TIMEOUT_MS,
    dev: {
      apiReadyTimeoutMs: raw.M0_DEV_API_READY_TIMEOUT_MS,
      apiProbeTimeoutMs: raw.M0_DEV_API_PROBE_TIMEOUT_MS,
      apiPollIntervalMs: raw.M0_DEV_API_POLL_INTERVAL_MS,
      childStopTimeoutMs: raw.M0_DEV_CHILD_STOP_TIMEOUT_MS,
      postgresStartTimeoutSeconds: raw.M0_POSTGRES_START_TIMEOUT_SECONDS,
    },
    applications: [
      {
        id: raw.M0_APP_ID,
        name: raw.M0_APP_NAME,
        token: raw.M0_APP_TOKEN,
      },
      {
        id: raw.M0_TEST_APP_ID,
        name: raw.M0_TEST_APP_NAME,
        token: raw.M0_TEST_APP_TOKEN,
      },
    ],
    gateway: {
      openrouterApiKey: raw.M2_OPENROUTER_API_KEY,
      anthropicApiKey: raw.M2_ANTHROPIC_API_KEY,
    },
    playwright: {
      browserName: raw.PLAYWRIGHT_BROWSER_NAME,
      channel: raw.PLAYWRIGHT_CHANNEL,
      timeoutMs: raw.PLAYWRIGHT_TEST_TIMEOUT_MS,
      webServerTimeoutMs: raw.PLAYWRIGHT_WEB_SERVER_TIMEOUT_MS,
      viewportWidth: raw.PLAYWRIGHT_VIEWPORT_WIDTH,
      viewportHeight: raw.PLAYWRIGHT_VIEWPORT_HEIGHT,
      reuseExistingServer: raw.PLAYWRIGHT_REUSE_EXISTING_SERVER,
    },
  };

  const localOperatorToken = raw.M1_LOCAL_OPERATOR_TOKEN;
  const localRunnerToken = raw.M1_LOCAL_RUNNER_TOKEN;
  if (
    localOperatorToken &&
    (localOperatorToken.length < 32 ||
      config.applications.some((app) => app.token === localOperatorToken))
  ) {
    throw new Error(
      'Local operator token must be distinct and at least 32 characters.',
    );
  }
  if (
    localRunnerToken &&
    (localRunnerToken.length < 32 ||
      localRunnerToken === localOperatorToken ||
      config.applications.some((app) => app.token === localRunnerToken))
  ) {
    throw new Error(
      'Local runner token must be distinct and at least 32 characters.',
    );
  }

  const hosting =
    config.runtimeMode === 'm1-oidc'
      ? hostingContract({
          publicOrigin: reqStr('M1_PUBLIC_ORIGIN').parse(raw.M1_PUBLIC_ORIGIN),
          appId: reqStr('M1_APP_ID').parse(raw.M1_APP_ID),
          clientId: reqStr('M1_OIDC_CLIENT_ID').parse(raw.M1_OIDC_CLIENT_ID),
          callbackUri: reqStr('M1_OIDC_CALLBACK_URI').parse(
            raw.M1_OIDC_CALLBACK_URI,
          ),
          logoutUri: reqStr('M1_OIDC_LOGOUT_URI').parse(raw.M1_OIDC_LOGOUT_URI),
        })
      : undefined;

  const oidc = hosting
    ? {
        issuer: reqStr('M1_OIDC_ISSUER').parse(raw.M1_OIDC_ISSUER),
        audience: reqStr('M1_OIDC_AUDIENCE').parse(raw.M1_OIDC_AUDIENCE),
        jwksUri: reqStr('M1_OIDC_JWKS_URI').parse(raw.M1_OIDC_JWKS_URI),
        operatorClientId: hosting.clientId,
        runnerClientId: raw.M1_OIDC_RUNNER_CLIENT_ID,
      }
    : undefined;

  if (config.runtimeMode === 'm0-local') {
    assertLoopback(config.apiHost, 'M0_API_HOST');
    assertLoopback(config.webHost, 'M0_WEB_HOST');
    assertLoopback(config.database.host, 'M0_DB_HOST');
    if (config.database.name !== 'ai_runtime_m0') {
      throw new Error('M0_DB_NAME must be ai_runtime_m0.');
    }
    if (config.applications.some((app) => app.token.length < 32)) {
      throw new Error('M0 application tokens must be at least 32 characters.');
    }
    for (const host of config.allowedHosts) {
      assertLoopback(host, 'M0_ALLOWED_HOSTS');
    }
    for (const origin of config.allowedOrigins) {
      const parsed = new URL(origin);
      assertLoopback(parsed.hostname, 'M0_ALLOWED_ORIGINS');
    }
  }

  if (config.database.managePostgres && config.database.pgBin === 'UNUSED') {
    throw new Error(
      'PG_BIN must point to PostgreSQL binaries when M0_MANAGE_POSTGRES=true.',
    );
  }

  return Object.freeze({
    ...config,
    localOperatorToken: hosting ? undefined : localOperatorToken,
    localRunnerToken: hosting ? undefined : localRunnerToken,
    hosting,
    oidc,
    databaseUrl: databaseUrl(config.database),
  });
}

export const projectRoot = root;

// ---------------------------------------------------------------------------
// Web Environment Projection
// ---------------------------------------------------------------------------

const webCommonSchema = z.object({
  M0_RUNTIME_MODE: z.enum(['m0-local', 'm1-oidc'], {
    message: 'M0_RUNTIME_MODE must be m0-local or m1-oidc.',
  }),
  M0_WEB_HOST: reqStr('M0_WEB_HOST'),
  M0_WEB_PORT: intEnv('M0_WEB_PORT'),
  M0_API_REQUEST_TIMEOUT_MS: intEnv('M0_API_REQUEST_TIMEOUT_MS'),
  M0_API_BODY_LIMIT_BYTES: intEnv('M0_API_BODY_LIMIT_BYTES'),
  WEB_RESPONSE_LIMIT_BYTES: intEnv('WEB_RESPONSE_LIMIT_BYTES'),
  WEB_DOCS_ROOT: reqStr('WEB_DOCS_ROOT'),
});

const webLocalSchema = z.object({
  M0_API_HOST: reqStr('M0_API_HOST'),
  M0_API_PORT: intEnv('M0_API_PORT'),
  M0_ALLOWED_ORIGINS: listEnv('M0_ALLOWED_ORIGINS'),
  M0_APP_TOKEN: reqStr('M0_APP_TOKEN'),
  M1_LOCAL_OPERATOR_TOKEN: reqStr('M1_LOCAL_OPERATOR_TOKEN'),
});

const webOidcSchema = z.object({
  M1_PUBLIC_ORIGIN: reqStr('M1_PUBLIC_ORIGIN'),
  M1_APP_ID: reqStr('M1_APP_ID'),
  M1_OIDC_CLIENT_ID: reqStr('M1_OIDC_CLIENT_ID'),
  M1_OIDC_CALLBACK_URI: reqStr('M1_OIDC_CALLBACK_URI'),
  M1_OIDC_LOGOUT_URI: reqStr('M1_OIDC_LOGOUT_URI'),
  M1_API_ORIGIN: reqStr('M1_API_ORIGIN'),
  M1_OIDC_ISSUER: reqStr('M1_OIDC_ISSUER'),
  M1_OIDC_JWKS_URI: reqStr('M1_OIDC_JWKS_URI'),
  M1_SESSION_SECRET: reqStr('M1_SESSION_SECRET'),
  M1_SESSION_REDIS_URL: reqStr('M1_SESSION_REDIS_URL'),
  M1_OIDC_AUDIENCE: reqStr('M1_OIDC_AUDIENCE'),
  M1_OIDC_CLIENT_SECRET: reqStr('M1_OIDC_CLIENT_SECRET'),
  M1_SESSION_TTL_SECONDS: intEnv('M1_SESSION_TTL_SECONDS'),
  M1_LOGIN_TTL_SECONDS: intEnv('M1_LOGIN_TTL_SECONDS'),
  M1_REFRESH_SKEW_SECONDS: intEnv('M1_REFRESH_SKEW_SECONDS'),
  M1_SESSION_REDIS_CONNECT_TIMEOUT_MS: intEnv(
    'M1_SESSION_REDIS_CONNECT_TIMEOUT_MS',
  ),
  M1_SESSION_LOCK_MS: intEnv('M1_SESSION_LOCK_MS'),
  M1_SESSION_LOCK_WAIT_MS: intEnv('M1_SESSION_LOCK_WAIT_MS'),
  M1_SESSION_LOCK_POLL_MS: intEnv('M1_SESSION_LOCK_POLL_MS'),
  M1_OIDC_SCOPES: listEnv('M1_OIDC_SCOPES'),
});

/** Web-only projection of the SAME env gate. Never loads database credentials. */
export function loadWebEnvironment() {
  loadDotEnv();
  const commonRaw = parseWithSchema(webCommonSchema, process.env);
  const runtimeMode = commonRaw.M0_RUNTIME_MODE;
  const local = runtimeMode === 'm0-local';
  const webHost = commonRaw.M0_WEB_HOST;
  const webPort = commonRaw.M0_WEB_PORT;
  const requestTimeoutMs = commonRaw.M0_API_REQUEST_TIMEOUT_MS;
  const bodyLimitBytes = commonRaw.M0_API_BODY_LIMIT_BYTES;
  const responseLimitBytes = commonRaw.WEB_RESPONSE_LIMIT_BYTES;
  const docsRoot = resolve(root, commonRaw.WEB_DOCS_ROOT);

  const common = {
    runtimeMode,
    webHost,
    webPort,
    requestTimeoutMs,
    bodyLimitBytes,
    responseLimitBytes,
    docsRoot,
  };

  if (local) {
    const localRaw = parseWithSchema(webLocalSchema, process.env);
    const apiHost = localRaw.M0_API_HOST;
    const apiPort = localRaw.M0_API_PORT;
    assertLoopback(webHost, 'M0_WEB_HOST');
    assertLoopback(apiHost, 'M0_API_HOST');
    const origins = localRaw.M0_ALLOWED_ORIGINS.filter((value) => {
      const origin = new URL(value);
      assertLoopback(origin.hostname, 'M0_ALLOWED_ORIGINS');
      return origin.origin === value && origin.port === String(webPort);
    });
    const origin = 'http://' + webHost + ':' + webPort;
    if (!origins.includes(origin)) {
      throw new Error('Web origin must be explicitly allowed.');
    }
    const applicationToken = localRaw.M0_APP_TOKEN;
    const operatorToken = localRaw.M1_LOCAL_OPERATOR_TOKEN;
    if (
      applicationToken.length < 32 ||
      operatorToken.length < 32 ||
      applicationToken === operatorToken
    ) {
      throw new Error(
        'Distinct local application/operator tokens of at least 32 characters are required.',
      );
    }
    return Object.freeze({
      ...common,
      local: true,
      publicOrigin: origin,
      allowedOrigins: origins,
      apiOrigin: 'http://' + apiHost + ':' + apiPort,
      applicationToken,
      operatorToken,
      hosting: undefined,
      auth: undefined,
    });
  }

  const oidcRaw = parseWithSchema(webOidcSchema, process.env);
  const hosting = hostingContract({
    publicOrigin: oidcRaw.M1_PUBLIC_ORIGIN,
    appId: oidcRaw.M1_APP_ID,
    clientId: oidcRaw.M1_OIDC_CLIENT_ID,
    callbackUri: oidcRaw.M1_OIDC_CALLBACK_URI,
    logoutUri: oidcRaw.M1_OIDC_LOGOUT_URI,
  });

  const apiOrigin = oidcRaw.M1_API_ORIGIN;
  const api = new URL(apiOrigin);
  if (
    !['http:', 'https:'].includes(api.protocol) ||
    api.origin !== apiOrigin ||
    api.username ||
    api.password
  ) {
    throw new Error('M1_API_ORIGIN must be an exact HTTP(S) origin.');
  }

  const issuer = oidcRaw.M1_OIDC_ISSUER;
  const jwksUri = oidcRaw.M1_OIDC_JWKS_URI;
  for (const value of [issuer, jwksUri]) {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.hash ||
      url.search
    ) {
      throw new Error(
        'OIDC endpoints require HTTPS without credentials/query/fragment.',
      );
    }
  }
  if (new URL(jwksUri).origin !== new URL(issuer).origin) {
    throw new Error('JWKS must be on the issuer origin.');
  }

  const sessionSecret = oidcRaw.M1_SESSION_SECRET;
  if (!/^[a-f0-9]{64}$/i.test(sessionSecret)) {
    throw new Error(
      'M1_SESSION_SECRET must be 32 random bytes encoded as 64 hex characters.',
    );
  }

  const redisUrl = oidcRaw.M1_SESSION_REDIS_URL;
  if (!['redis:', 'rediss:'].includes(new URL(redisUrl).protocol)) {
    throw new Error('Session store requires a Redis URL.');
  }

  const sessionTtlSeconds = oidcRaw.M1_SESSION_TTL_SECONDS;
  const loginTtlSeconds = oidcRaw.M1_LOGIN_TTL_SECONDS;
  const refreshSkewSeconds = oidcRaw.M1_REFRESH_SKEW_SECONDS;
  const redisConnectTimeoutMs = oidcRaw.M1_SESSION_REDIS_CONNECT_TIMEOUT_MS;
  const lockMs = oidcRaw.M1_SESSION_LOCK_MS;
  const lockWaitMs = oidcRaw.M1_SESSION_LOCK_WAIT_MS;
  const lockPollMs = oidcRaw.M1_SESSION_LOCK_POLL_MS;
  const scopes = oidcRaw.M1_OIDC_SCOPES;

  if (
    !scopes.includes('openid') ||
    sessionTtlSeconds > 86400 ||
    loginTtlSeconds > 600 ||
    refreshSkewSeconds >= sessionTtlSeconds ||
    lockMs <= 4 * requestTimeoutMs + 4 * redisConnectTimeoutMs ||
    lockWaitMs < lockMs ||
    lockPollMs >= lockWaitMs
  ) {
    throw new Error('Invalid OIDC scope, lifetime, or session lock policy.');
  }

  return Object.freeze({
    ...common,
    local: false,
    publicOrigin: hosting.publicOrigin,
    allowedOrigins: [hosting.publicOrigin],
    apiOrigin,
    applicationToken: undefined,
    operatorToken: undefined,
    hosting,
    auth: {
      issuer,
      jwksUri,
      audience: oidcRaw.M1_OIDC_AUDIENCE,
      clientSecret: oidcRaw.M1_OIDC_CLIENT_SECRET,
      scopes,
      sessionSecret,
      redisUrl,
      sessionTtlSeconds,
      loginTtlSeconds,
      refreshSkewSeconds,
      lockMs,
      lockWaitMs,
      lockPollMs,
      redisConnectTimeoutMs,
    },
  });
}

// ---------------------------------------------------------------------------
// Isolated Test Targets
// ---------------------------------------------------------------------------

const sessionTestSchema = z.object({
  BFF_TEST_REDIS_URL: reqStr('BFF_TEST_REDIS_URL'),
  BFF_TEST_TIMEOUT_MS: intEnv('BFF_TEST_TIMEOUT_MS'),
});

/** Explicit, loopback-only integration-test target; never a production fallback. */
export function loadSessionTestEnvironment() {
  loadDotEnv();
  const raw = parseWithSchema(sessionTestSchema, process.env);
  const endpoint = new URL(raw.BFF_TEST_REDIS_URL);
  assertLoopback(endpoint.hostname, 'BFF_TEST_REDIS_URL');
  if (!['redis:', 'rediss:'].includes(endpoint.protocol)) {
    throw new Error('BFF_TEST_REDIS_URL must use the Redis protocol.');
  }
  return { url: raw.BFF_TEST_REDIS_URL, timeoutMs: raw.BFF_TEST_TIMEOUT_MS };
}

const pactEnvironmentSchema = z.object({
  PACT_BROKER_BASE_URL: reqStr('PACT_BROKER_BASE_URL'),
  PACT_VERSION: reqStr('PACT_VERSION').refine((v) => /^[a-f0-9]{40}$/.test(v), {
    message: 'PACT_VERSION must be the full Git commit SHA.',
  }),
  PACT_ENVIRONMENT: reqStr('PACT_ENVIRONMENT').refine(
    (v) => /^[a-z][a-z0-9-]{0,63}$/.test(v),
    { message: 'Invalid Pact environment.' },
  ),
  PACT_BRANCH: reqStr('PACT_BRANCH'),
  PACT_BROKER_TOKEN: optStr(),
  PACT_TIMEOUT_MS: intEnv('PACT_TIMEOUT_MS'),
});

/** Contract delivery has its own projection, never its own configuration store. */
export function loadPactEnvironment() {
  loadDotEnv();
  if (
    process.env.PACT_BROKER_CAN_I_DEPLOY_DRY_RUN ||
    process.env.PACT_BROKER_CAN_I_DEPLOY_IGNORE ||
    process.env.SSL_SKIP_VERIFICATION === 'true' ||
    process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0'
  ) {
    throw new Error(
      'Contract gates cannot use dry-run, ignore, or disabled TLS verification.',
    );
  }

  const raw = parseWithSchema(pactEnvironmentSchema, process.env);
  const parsed = new URL(raw.PACT_BROKER_BASE_URL);
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(
    parsed.hostname,
  );
  if (
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    (parsed.protocol !== 'https:' && !(loopback && parsed.protocol === 'http:'))
  ) {
    throw new Error(
      'Pact Broker requires HTTPS; HTTP is permitted only for isolated loopback tests.',
    );
  }

  const token = loopback
    ? raw.PACT_BROKER_TOKEN
    : reqStr('PACT_BROKER_TOKEN').parse(raw.PACT_BROKER_TOKEN);

  return Object.freeze({
    url: raw.PACT_BROKER_BASE_URL,
    version: raw.PACT_VERSION,
    environment: raw.PACT_ENVIRONMENT,
    branch: raw.PACT_BRANCH,
    token,
    timeoutMs: raw.PACT_TIMEOUT_MS,
    loopback,
  });
}
