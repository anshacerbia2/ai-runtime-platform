# Configuration — Single Environment Gate

M0 mempunyai satu configuration authority: **environment variables**. Local development biasanya memuatnya dari root `.env`; CI memasok variable yang sama melalui job environment. Semua consumer memakai `config/environment.mjs`.

Runtime/tooling tidak membaca `.local/config.json`, tidak mencari PostgreSQL binary otomatis, dan tidak mempunyai silent fallback untuk variable wajib. Missing, blank, atau invalid variable membuat startup/tool command gagal sebelum melakukan pekerjaan.

## Bootstrap

```powershell
npm run env:init
# review .env
npm run setup
```

`env:init` menyalin `.env.example`, mengganti hanya marker secret dengan random local values, menolak overwrite `.env` yang sudah ada, lalu berhenti. Ia bukan runtime fallback.

## Core HTTP

| Variable                     | Meaning                                    |
| ---------------------------- | ------------------------------------------ |
| `M0_RUNTIME_MODE`            | Must be `m0-local`                         |
| `M0_API_HOST`, `M0_API_PORT` | API bind address                           |
| `M0_WEB_HOST`, `M0_WEB_PORT` | Vite bind address                          |
| `M0_ALLOWED_HOSTS`           | Explicit comma-separated host allow-list   |
| `M0_ALLOWED_ORIGINS`         | Explicit comma-separated origin allow-list |
| `M0_API_BODY_LIMIT_BYTES`    | Fastify body cap                           |
| `M0_API_REQUEST_TIMEOUT_MS`  | Fastify request timeout                    |

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

Tokens are local M0 credentials only; they are replaced by Keycloak/Application Registry work in P1.

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

## Rules

1. Add a configurable value to `.env.example` first, then to the canonical loader and this document.
2. Do not use `process.env.X ?? default` outside `config/environment.mjs`.
3. Do not introduce a second JSON/YAML/local config source for runtime values.
4. Derived values such as `databaseUrl` may be constructed from validated env; they are not separate inputs.
5. Static protocol/domain constants are code/contracts, not environment configuration.
6. Secrets remain Git-ignored and must never be logged or returned to the browser.

Production M1+ may replace local secret material with Keycloak/Vault/workload identity, but the rule remains: one validated configuration boundary per deployable, fail closed on missing required configuration.
