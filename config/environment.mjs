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
          clientSecret: required('M1_OIDC_CLIENT_SECRET'),
          callbackUri: required('M1_OIDC_CALLBACK_URI'),
          logoutUri: required('M1_OIDC_LOGOUT_URI'),
          proxySecret: required('M1_PROXY_SECRET'),
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
