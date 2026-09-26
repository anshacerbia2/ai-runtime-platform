# Configuration — Single Environment Gate

M0/M1, resource APIs dan BFF mempunyai satu configuration authority: **environment variables**. Local development biasanya memuatnya dari root `.env`; CI memasok variable yang sama melalui job environment. Semua consumer memakai `config/environment.mjs`. Untuk landasan teoritis, taksonomi tingkat maturitas, dan roadmap evolusi konfigurasi dari primitif hingga beyond FAANG, lihat [docs/architecture/ENV-MATURITY-MODEL.md](../architecture/ENV-MATURITY-MODEL.md).

Runtime/tooling tidak membaca `.local/config.json`, tidak mencari PostgreSQL binary otomatis, dan tidak mempunyai silent fallback untuk variable wajib. Missing, blank, atau invalid variable membuat startup/tool command gagal sebelum melakukan pekerjaan.

## Bootstrap

```powershell
npm run env:init
# review .env
npm run setup
```

`env:init` menyalin `.env.example`, mengganti hanya marker secret dengan random local values, menolak overwrite `.env` yang sudah ada, lalu berhenti. Ia bukan runtime fallback.

## Core HTTP

| Variable                     | Meaning                                                                                |
| ---------------------------- | -------------------------------------------------------------------------------------- |
| `M0_RUNTIME_MODE`            | `m0-local` for local lab/tests; `m1-oidc` for nonlocal platform-owned OIDC/BFF hosting |
| `M0_API_HOST`, `M0_API_PORT` | API bind address                                                                       |
| `M0_WEB_HOST`, `M0_WEB_PORT` | Web tier (Next.js) bind address                                                        |
| `M0_ALLOWED_HOSTS`           | Explicit comma-separated host allow-list                                               |
| `M0_ALLOWED_ORIGINS`         | Explicit comma-separated origin allow-list                                             |
| `M0_API_BODY_LIMIT_BYTES`    | Fastify body cap                                                                       |
| `M0_API_REQUEST_TIMEOUT_MS`  | Fastify timeout and BFF local wait bound, not provider/execution cancellation          |

## PostgreSQL and Prisma

| Variable                                          | Meaning                                                                                    |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `M0_DB_HOST`, `M0_DB_PORT`, `M0_DB_NAME`          | Database endpoint; M0 enforces loopback + `ai_runtime_m0`                                  |
| `M0_DB_USER`, `M0_DB_PASSWORD`                    | Local DB credential                                                                        |
| `M0_MANAGE_POSTGRES`                              | Explicit `true`/`false`; whether repo starts/stops PostgreSQL                              |
| `PG_BIN`                                          | PostgreSQL binary directory; required explicitly even when marked `UNUSED` in unmanaged CI |
| `M0_POSTGRES_DATA_DIR`, `M0_POSTGRES_LOG_FILE`    | Managed cluster paths                                                                      |
| `M0_DB_POOL_MAX`                                  | Prisma adapter pool cap                                                                    |
| `M0_DB_CONNECTION_TIMEOUT_MS`                     | DB connect timeout                                                                         |
| `M0_DB_IDLE_TIMEOUT_MS`                           | DB idle timeout                                                                            |
| `M0_DB_STATEMENT_TIMEOUT_MS`                      | DB statement timeout                                                                       |
| `M0_DB_APPLICATION_NAME`                          | PostgreSQL application name                                                                |
| `M0_SEED_TX_MAX_WAIT_MS`, `M0_SEED_TX_TIMEOUT_MS` | Seed transaction bounds                                                                    |

`DATABASE_URL` is not an input gate. The canonical loader constructs the Prisma/PostgreSQL URL from the explicit DB variables above so there is no second configuration path.

## Local application identities

| Variable                                                  | Meaning                           |
| --------------------------------------------------------- | --------------------------------- |
| `M0_APP_ID`, `M0_APP_NAME`, `M0_APP_TOKEN`                | Contract Lab application identity |
| `M0_TEST_APP_ID`, `M0_TEST_APP_NAME`, `M0_TEST_APP_TOKEN` | Cross-app isolation fixture       |

These are local application fixtures only. The nonlocal OIDC/Application Registry path is implemented in source but live deployment evidence is separate. Never reuse local fixtures as production credentials.

## M1 identity and external-app hosting

For local M1 tests, optional credentials remain separate from application credentials:

| Variable                  | Meaning                                                                    |
| ------------------------- | -------------------------------------------------------------------------- |
| `M1_LOCAL_OPERATOR_TOKEN` | Local-only operator/admin authority used by the Control Plane test/UI path |
| `M1_LOCAL_RUNNER_TOKEN`   | Local-only runner registration/report/evidence authority                   |

For nonlocal `m1-oidc` mode, configuration is fail-closed:

| Variable                | Meaning                                                                       |
| ----------------------- | ----------------------------------------------------------------------------- |
| `M1_PUBLIC_ORIGIN`      | Exact HTTPS public origin of **this platform**; no mount prefix               |
| `M1_APP_ID`             | ATI One catalogue id; also fixes the `<app-id>-app` client-id convention      |
| `M1_OIDC_CLIENT_ID`     | Dedicated confidential client id; must follow `<app-id>-app`                  |
| `M1_OIDC_CLIENT_SECRET` | Confidential client secret; held by the BFF, never sent to the browser        |
| `M1_OIDC_CALLBACK_URI`  | Exact callback URI; `<public-origin>/auth/callback`                           |
| `M1_OIDC_LOGOUT_URI`    | Exact post-logout URI; `<public-origin>/auth/logged-out`                      |
| `M1_OIDC_ISSUER`        | Trusted Keycloak issuer (the deployment fronted by ai-portal)                 |
| `M1_OIDC_AUDIENCE`      | Required runtime API audience                                                 |
| `M1_OIDC_JWKS_URI`      | Trusted HTTPS JWKS endpoint on the issuer origin                              |
| `M1_SESSION_SECRET`     | BFF server-session encryption and cookie-reference signing key; web tier only |

`M1_PROXY_SECRET` is **retired**. It carried the per-app ATI One proxy credential, which external-app delivery removes; no route validates a proxy header. See [ADR-0025](../adr/0025-external-app-standalone-auth.md).

The API validates issuer/audience/signature/expiry/nbf/azp plus role/scope separation. An application client is resolved through the durable Application Registry; operator and runner identities cannot silently become application callers.

### Issuer separation per environment

When using the shared production Keycloak issuer as the deployment target, environment separation is a configuration rule and not a convention; this does not mean local tests contacted that issuer:

1. `M1_OIDC_CLIENT_ID` and `M1_OIDC_CLIENT_SECRET` MUST differ per environment.
2. Loopback or non-production callback URIs MUST NOT be registered on the client used by production.
3. A production client secret MUST NOT be placed in a developer `.env`.
4. Local development runs `m0-local`, which contacts no production issuer.

## Development and browser tests

| Variable                                                  | Meaning                                                                   |
| --------------------------------------------------------- | ------------------------------------------------------------------------- |
| `M0_DEV_API_READY_TIMEOUT_MS`                             | Total API readiness window                                                |
| `M0_DEV_API_PROBE_TIMEOUT_MS`                             | Per readiness probe timeout                                               |
| `M0_DEV_API_POLL_INTERVAL_MS`                             | Readiness polling interval                                                |
| `M0_DEV_CHILD_STOP_TIMEOUT_MS`                            | Grace period before owned child escalation                                |
| `M0_POSTGRES_START_TIMEOUT_SECONDS`                       | `pg_ctl` startup timeout                                                  |
| `PLAYWRIGHT_BROWSER_NAME`                                 | Explicit Playwright browser family                                        |
| `PLAYWRIGHT_CHANNEL`                                      | Explicit browser channel; use `none` to select Playwright bundled browser |
| `PLAYWRIGHT_TEST_TIMEOUT_MS`                              | Test timeout                                                              |
| `PLAYWRIGHT_WEB_SERVER_TIMEOUT_MS`                        | Web server startup timeout                                                |
| `PLAYWRIGHT_VIEWPORT_WIDTH`, `PLAYWRIGHT_VIEWPORT_HEIGHT` | Test viewport                                                             |
| `PLAYWRIGHT_REUSE_EXISTING_SERVER`                        | Explicit `true`/`false`                                                   |

## Contract constants are not new environment variables

The source declares unary safety ceilings (30 seconds, 8 MiB response and 64 KiB diagnostic body), resource page/mutation limits, receipt replay window seven days, pagination 20/100 and operation retry policy. RetryBudget currently starts with ten tokens and refills one per second. These are contract/code constants, not missing env keys or production-calibrated SLOs. See [current limits](../operations/SLO-CAPACITY.md).

Changing protocol limits requires updating source, generated artifacts and tests; editing this page alone does not change behavior. Assignment metadata declaring maxMessageBytes does not create a second transport configuration gate. Runner protocol and auth use the existing API process configuration.

Optional M1_OIDC_RUNNER_CLIENT_ID maps nonlocal runner identity in the API projection. It does not launch runners or create Redis heartbeat state. For temporary browser test ports, M0_ALLOWED_ORIGINS must include the exact web origin, including its port. M0_ALLOWED_HOSTS contains allowed host names separately. Required local secrets must never be printed while checking these values.

## Rules

1. Add a configurable value to `.env.example` first, then to the canonical loader and this document.
2. Do not use `process.env.X ?? default` outside `config/environment.mjs`.
3. Do not introduce a second JSON/YAML/local config source for runtime values.
4. Derived values such as `databaseUrl` may be constructed from validated env; they are not separate inputs.
5. Static protocol/domain constants are code/contracts, not environment configuration.
6. Secrets remain Git-ignored and must never be logged or returned to the browser.

Production M1+ may replace local secret material with Keycloak/Vault/workload identity, but the rule remains: one validated configuration boundary per deployable, fail closed on missing required configuration.

## Implemented Next.js/BFF projection

`loadWebEnvironment()` reads the web deployment projection from this same module. It does not require PostgreSQL credentials. The API's `loadEnvironment()` does not require the confidential client secret, session encryption key, or session Redis credentials. Keep process environments least-privileged in deployment.

| Variable                              | Required in                     | Meaning                                                                                        |
| ------------------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------- |
| `WEB_DOCS_ROOT`                       | Both modes                      | Markdown root, resolved against the repository root                                            |
| `WEB_RESPONSE_LIMIT_BYTES`            | Both modes                      | Maximum buffered API response size                                                             |
| `M1_API_ORIGIN`                       | `m1-oidc`                       | Exact private HTTP(S) API origin; never taken from browser input                               |
| `M1_OIDC_SCOPES`                      | `m1-oidc`                       | Comma-separated requested scopes, including `openid`; API roles/scopes remain required         |
| `M1_SESSION_REDIS_URL`                | `m1-oidc`                       | Protected server-side session Redis; not the runner heartbeat tier                             |
| `M1_SESSION_SECRET`                   | `m1-oidc`                       | 32 random bytes encoded as 64 hex characters; seals server records and signs opaque references |
| `M1_SESSION_TTL_SECONDS`              | `m1-oidc`                       | Absolute session lifetime; maximum 24 hours                                                    |
| `M1_LOGIN_TTL_SECONDS`                | `m1-oidc`                       | One-use authorization transaction lifetime; maximum 10 minutes                                 |
| `M1_REFRESH_SKEW_SECONDS`             | `m1-oidc`                       | Refresh threshold before access-token expiration                                               |
| `M1_SESSION_REDIS_CONNECT_TIMEOUT_MS` | `m1-oidc`                       | Bounded Redis connection, socket, and command timeout                                          |
| `M1_SESSION_LOCK_MS`                  | `m1-oidc`                       | Refresh lease; must exceed four request timeouts plus four Redis timeouts                      |
| `M1_SESSION_LOCK_WAIT_MS`             | `m1-oidc`                       | Bounded contention wait, at least the configured lease length                                  |
| `M1_SESSION_LOCK_POLL_MS`             | `m1-oidc`                       | Refresh contention poll interval                                                               |
| `BFF_TEST_REDIS_URL`                  | Explicit Redis integration test | Isolated loopback Redis only; random test namespaces                                           |
| `BFF_TEST_TIMEOUT_MS`                 | Explicit Redis integration test | Integration-store connection/command timeout                                                   |

Local web mode requires a distinct `M1_LOCAL_OPERATOR_TOKEN`, because the Control Plane is an operator surface. Local application credentials are used only for M0 requests. Missing values do not switch to another identity, a memory session store, or a different origin. `env:init` generates fixture tokens only when explicitly initializing a new checkout.

See [Web/BFF Operations](WEB.md) for startup, session rotation, logout semantics, and verification commands.
