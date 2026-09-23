import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from 'node:process';
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

function required(name) {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

function integer(name, minimum = 1) {
  const raw = required(name);
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum) {
    throw new Error(`${name} must be an integer >= ${minimum}.`);
  }
  return value;
}
function boolean(name) {
  const raw = required(name);
  if (raw === 'true') {
    return true;
  }
  if (raw === 'false') {
    return false;
  }
  throw new Error(`${name} must be exactly true or false.`);
}

function list(name) {
  const values = required(name)
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (!values.length) {
    throw new Error(`${name} must contain at least one value.`);
  }
  return values;
}

function assertLoopback(host, label) {
  if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host)) {
    throw new Error(`${label} must use a loopback host for M0.`);
  }
}

function databaseUrl(config) {
  const url = new URL('postgresql://localhost');
  url.username = config.database.user;
  url.password = config.database.password;
  url.hostname = config.database.host;
  url.port = String(config.database.port);
  url.pathname = `/${config.database.name}`;
  return url.toString();
}
export function loadEnvironment() {
  loadDotEnv();
  const config = {
    runtimeMode: required('M0_RUNTIME_MODE'),
    apiHost: required('M0_API_HOST'),
    apiPort: integer('M0_API_PORT'),
    webHost: required('M0_WEB_HOST'),
    webPort: integer('M0_WEB_PORT'),
    allowedHosts: list('M0_ALLOWED_HOSTS'),
    allowedOrigins: list('M0_ALLOWED_ORIGINS'),
    apiBodyLimitBytes: integer('M0_API_BODY_LIMIT_BYTES'),
    apiRequestTimeoutMs: integer('M0_API_REQUEST_TIMEOUT_MS'),
    database: {
      host: required('M0_DB_HOST'),
      port: integer('M0_DB_PORT'),
      name: required('M0_DB_NAME'),
      user: required('M0_DB_USER'),
      password: required('M0_DB_PASSWORD'),
      managePostgres: boolean('M0_MANAGE_POSTGRES'),
      pgBin: required('PG_BIN'),
      dataDir: required('M0_POSTGRES_DATA_DIR'),
      logFile: required('M0_POSTGRES_LOG_FILE'),
      poolMax: integer('M0_DB_POOL_MAX'),
      connectionTimeoutMs: integer('M0_DB_CONNECTION_TIMEOUT_MS'),
      idleTimeoutMs: integer('M0_DB_IDLE_TIMEOUT_MS'),
      statementTimeoutMs: integer('M0_DB_STATEMENT_TIMEOUT_MS'),
      applicationName: required('M0_DB_APPLICATION_NAME'),
    },
    seedTxMaxWaitMs: integer('M0_SEED_TX_MAX_WAIT_MS'),
    seedTxTimeoutMs: integer('M0_SEED_TX_TIMEOUT_MS'),
    dev: {
      apiReadyTimeoutMs: integer('M0_DEV_API_READY_TIMEOUT_MS'),
      apiProbeTimeoutMs: integer('M0_DEV_API_PROBE_TIMEOUT_MS'),
      apiPollIntervalMs: integer('M0_DEV_API_POLL_INTERVAL_MS'),
      childStopTimeoutMs: integer('M0_DEV_CHILD_STOP_TIMEOUT_MS'),
      postgresStartTimeoutSeconds: integer('M0_POSTGRES_START_TIMEOUT_SECONDS'),
    },
    applications: [
      {
        id: required('M0_APP_ID'),
        name: required('M0_APP_NAME'),
        token: required('M0_APP_TOKEN'),
      },
      {
        id: required('M0_TEST_APP_ID'),
        name: required('M0_TEST_APP_NAME'),
        token: required('M0_TEST_APP_TOKEN'),
      },
    ],
    playwright: {
      browserName: required('PLAYWRIGHT_BROWSER_NAME'),
      channel: required('PLAYWRIGHT_CHANNEL'),
      timeoutMs: integer('PLAYWRIGHT_TEST_TIMEOUT_MS'),
      webServerTimeoutMs: integer('PLAYWRIGHT_WEB_SERVER_TIMEOUT_MS'),
      viewportWidth: integer('PLAYWRIGHT_VIEWPORT_WIDTH'),
      viewportHeight: integer('PLAYWRIGHT_VIEWPORT_HEIGHT'),
      reuseExistingServer: boolean('PLAYWRIGHT_REUSE_EXISTING_SERVER'),
    },
  };
  if (!['m0-local', 'm1-oidc'].includes(config.runtimeMode)) {
    throw new Error('M0_RUNTIME_MODE must be m0-local or m1-oidc.');
  }
  const localOperatorToken = process.env.M1_LOCAL_OPERATOR_TOKEN;
  const localRunnerToken = process.env.M1_LOCAL_RUNNER_TOKEN;
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
          publicOrigin: required('M1_PUBLIC_ORIGIN'),
          appId: required('M1_APP_ID'),
          clientId: required('M1_OIDC_CLIENT_ID'),
          callbackUri: required('M1_OIDC_CALLBACK_URI'),
          logoutUri: required('M1_OIDC_LOGOUT_URI'),
        })
      : undefined;
  const oidc = hosting
    ? {
        issuer: required('M1_OIDC_ISSUER'),
        audience: required('M1_OIDC_AUDIENCE'),
        jwksUri: required('M1_OIDC_JWKS_URI'),
        operatorClientId: hosting.clientId,
        runnerClientId: process.env.M1_OIDC_RUNNER_CLIENT_ID,
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
    databaseUrl: databaseUrl(config),
  });
}

export const projectRoot = root;

/** Web-only projection of the SAME env gate. Never loads database credentials. */
export function loadWebEnvironment() {
  loadDotEnv();
  const runtimeMode = required('M0_RUNTIME_MODE');
  if (!['m0-local', 'm1-oidc'].includes(runtimeMode)) {
    throw new Error('M0_RUNTIME_MODE must be m0-local or m1-oidc.');
  }
  const local = runtimeMode === 'm0-local';
  const webHost = required('M0_WEB_HOST');
  const webPort = integer('M0_WEB_PORT');
  const requestTimeoutMs = integer('M0_API_REQUEST_TIMEOUT_MS');
  const bodyLimitBytes = integer('M0_API_BODY_LIMIT_BYTES');
  const responseLimitBytes = integer('WEB_RESPONSE_LIMIT_BYTES');
  const docsRoot = resolve(root, required('WEB_DOCS_ROOT'));
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
    const apiHost = required('M0_API_HOST');
    const apiPort = integer('M0_API_PORT');
    assertLoopback(webHost, 'M0_WEB_HOST');
    assertLoopback(apiHost, 'M0_API_HOST');
    const origins = list('M0_ALLOWED_ORIGINS').filter((value) => {
      const origin = new URL(value);
      assertLoopback(origin.hostname, 'M0_ALLOWED_ORIGINS');
      return origin.origin === value && origin.port === String(webPort);
    });
    const origin = 'http://' + webHost + ':' + webPort;
    if (!origins.includes(origin)) {
      throw new Error('Web origin must be explicitly allowed.');
    }
    const applicationToken = required('M0_APP_TOKEN');
    const operatorToken = required('M1_LOCAL_OPERATOR_TOKEN');
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
  const hosting = hostingContract({
    publicOrigin: required('M1_PUBLIC_ORIGIN'),
    appId: required('M1_APP_ID'),
    clientId: required('M1_OIDC_CLIENT_ID'),
    callbackUri: required('M1_OIDC_CALLBACK_URI'),
    logoutUri: required('M1_OIDC_LOGOUT_URI'),
  });
  const apiOrigin = required('M1_API_ORIGIN');
  const api = new URL(apiOrigin);
  if (
    !['http:', 'https:'].includes(api.protocol) ||
    api.origin !== apiOrigin ||
    api.username ||
    api.password
  ) {
    throw new Error('M1_API_ORIGIN must be an exact HTTP(S) origin.');
  }
  const issuer = required('M1_OIDC_ISSUER');
  const jwksUri = required('M1_OIDC_JWKS_URI');
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
  const sessionSecret = required('M1_SESSION_SECRET');
  if (!/^[a-f0-9]{64}$/i.test(sessionSecret)) {
    throw new Error(
      'M1_SESSION_SECRET must be 32 random bytes encoded as 64 hex characters.',
    );
  }
  const redisUrl = required('M1_SESSION_REDIS_URL');
  if (!['redis:', 'rediss:'].includes(new URL(redisUrl).protocol)) {
    throw new Error('Session store requires a Redis URL.');
  }
  const sessionTtlSeconds = integer('M1_SESSION_TTL_SECONDS');
  const loginTtlSeconds = integer('M1_LOGIN_TTL_SECONDS');
  const refreshSkewSeconds = integer('M1_REFRESH_SKEW_SECONDS');
  const redisConnectTimeoutMs = integer('M1_SESSION_REDIS_CONNECT_TIMEOUT_MS');
  const lockMs = integer('M1_SESSION_LOCK_MS');
  const lockWaitMs = integer('M1_SESSION_LOCK_WAIT_MS');
  const lockPollMs = integer('M1_SESSION_LOCK_POLL_MS');
  const scopes = list('M1_OIDC_SCOPES');
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
      audience: required('M1_OIDC_AUDIENCE'),
      clientSecret: required('M1_OIDC_CLIENT_SECRET'),
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

/** Explicit, loopback-only integration-test target; never a production fallback. */
export function loadSessionTestEnvironment() {
  loadDotEnv();
  const url = required('BFF_TEST_REDIS_URL');
  const endpoint = new URL(url);
  assertLoopback(endpoint.hostname, 'BFF_TEST_REDIS_URL');
  if (!['redis:', 'rediss:'].includes(endpoint.protocol)) {
    throw new Error('BFF_TEST_REDIS_URL must use the Redis protocol.');
  }
  return { url, timeoutMs: integer('BFF_TEST_TIMEOUT_MS') };
}

/** Contract delivery has its own projection, never its own configuration store. */
export function loadPactEnvironment() {
  loadDotEnv();
  const url = required('PACT_BROKER_BASE_URL');
  const parsed = new URL(url);
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
  const version = required('PACT_VERSION');
  if (!/^[a-f0-9]{40}$/.test(version)) {
    throw new Error('PACT_VERSION must be the full Git commit SHA.');
  }
  const environment = required('PACT_ENVIRONMENT');
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(environment)) {
    throw new Error('Invalid Pact environment.');
  }
  return Object.freeze({
    url,
    version,
    environment,
    branch: required('PACT_BRANCH'),
    token: loopback
      ? process.env.PACT_BROKER_TOKEN
      : required('PACT_BROKER_TOKEN'),
    timeoutMs: integer('PACT_TIMEOUT_MS'),
    loopback,
  });
}
