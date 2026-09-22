# Next.js Web and BFF Operations

The frontend is React on **Next.js App Router**, not a Vite SPA. Existing CDD components and SCSS tokens remain in place. NestJS/Fastify remains the domain API and PostgreSQL correctness authority; the BFF has no Prisma client or domain database access.

## Local development

Run the existing root setup/development commands. The public entry is at the configured web origin; choose **Open local console**. Stable routes are `/contract-lab`, `/control-plane`, `/history`, `/schemas`, `/delivery-plan`, and `/docs`.

```powershell
npm ci
# New checkout only: npm run env:init
# Existing checkout: merge new keys from .env.example; never overwrite .env.
npm run dev
```

Local mode requires `WEB_DOCS_ROOT`, `WEB_RESPONSE_LIMIT_BYTES`, and a distinct `M1_LOCAL_OPERATOR_TOKEN` alongside the existing M0 variables. The explicit env initializer generates local operator/runner tokens on new checkouts. No missing key is silently generated during runtime startup. Local mode contacts neither a production issuer nor Redis; the BFF uses server-held local fixtures only on loopback.

The browser entry at `/` is intentionally no longer Contract Lab. Direct bookmarks to the feature paths, browser Back, and reload work independently of client state. Documentation is parsed/sanitized on the server and exposes only Markdown within the configured docs root, with traversal and symbolic-link checks.

## Nonlocal deployment

1. Provision an environment-specific confidential Keycloak client and a protected Redis session store. Do not reuse a production client secret for local development.
2. Configure the root environment contract for each process. The web process calls `loadWebEnvironment()`; the API uses `loadEnvironment()`. These are projections of the same env gate, not separate configuration stores.
3. Build, then run the web and API as separately supervised Node processes. Only the web origin is browser-facing. Keep the API reachable from the BFF over a trusted private network or authenticated TLS path.

```powershell
npm run build
npm run start -w @ai-runtime/web
# Separately supervised API process:
node apps/api/dist/main.js
```

The public origin is an exact HTTPS origin, with callback `/auth/callback` and app-local logout destination `/auth/logged-out`. Register the exact callback with Keycloak. The resource-server audience and client roles/scopes must match the API verifier; the BFF does not elevate those claims.

For the current non-standalone Next deployment, deploy the repository build plus dependencies and the docs tree. `WEB_DOCS_ROOT` is explicit and resolved against the repository root. Next output tracing includes the repository docs; an immutable release should rebuild/redeploy code and documentation together. No static-export deployment is supported.

## Session and identity boundaries

POST `/auth/login` begins Authorization Code + PKCE S256 with state and nonce. The callback verifies the issuer, signed ID token, audience, nonce, and one-use transaction. A login replaces the previous session reference. Passwords are entered only at Keycloak.

Browser cookies contain a random, signed reference, **not encrypted JWTs or token payloads**. Cookies use the client-specific `__Host-` namespace, `Secure`, `HttpOnly`, `SameSite=Lax`, and `Path=/`, without Domain. Access/refresh tokens are AES-GCM sealed in the Redis session record. The session lifetime is absolute, with no implicit indefinite renewal.

Redis conditional locks serialize refresh across BFF instances. Compare-and-set replacement prevents a refresh from reviving a session deleted by logout. Expired/unrefreshable/tampered sessions fail closed. All BFF replicas for an environment must use the same configured session key, client namespace, and session Redis. A store outage does not fall back to local memory or a browser token.

POST `/auth/logout` invalidates only the platform session and clears its cookies. It deliberately does not terminate the entire Keycloak realm session; ATI One and sibling app sessions are not cleared. Re-entry can use the existing realm SSO. Realm-wide/front-channel/back-channel logout integration is not claimed by this migration.

The API process does not need the confidential-client secret or session sealing key. The web process does not need the PostgreSQL credentials. Rotating `M1_SESSION_SECRET` invalidates all existing platform session/login references; plan a coordinated web restart and user reauthentication. Redis session data is disposable authentication state, not the accounting ledger.

## HTTP protection

The BFF allows only explicit M0/M1 route/method pairs. It ignores browser Authorization, cookies, proxy headers, and arbitrary upstream destinations when constructing the API hop. Mutations require an exact allowed Origin and JSON media type; auth forms also validate Origin. Fetch Metadata and Host checks reject cross-site and rebinding requests. Request and response bodies are bounded; redirects and arbitrary response headers are not forwarded. Server errors do not echo private upstream details.

Framing is denied. Runtime CSP allows form navigation only to self and the configured issuer origin; no wildcard issuer is used. Same-origin referrer policy preserves native POST Origin checks while suppressing cross-origin referrers. Public entry rendering does not establish an authenticated session.

This session Redis is distinct from the still-planned runner heartbeat/capacity/lease tier. Adding BFF sessions does not claim runner placement, provider execution, or production readiness.

## Verification

```powershell
npm run verify
npm run test:e2e
npm run web:bundle-check

# With an explicitly configured isolated loopback Redis:

npm run test:web:redis
```

The web suite tests real OIDC protocol-library behavior using generated signing keys and an injected issuer transport, plus refresh races, callback replay, logout, CSRF, allowlisted forwarding, bounded requests, and safe Markdown. It does not contact ATI Keycloak. Browser tests preserve M0/M1 workflows, test actual route navigation/logout, and verify docs without client JavaScript.

The production client-bundle scanner checks actual configured secrets and client-reference manifests. It does not replace review of future API response shapes or a penetration test. The dedicated Redis integration suite uses random test namespaces and two independent real clients; it never flushes the database. It requires `BFF_TEST_REDIS_URL` and `BFF_TEST_TIMEOUT_MS`, and runs against a disposable Redis service in CI.

Before a production release, obtain live Keycloak redirect/claim evidence, Redis TLS/ACL/availability and rotation evidence, ingress/API network isolation, and the operational sign-offs in the acceptance catalogue. A local build or fixture pass is not a substitute.

See [Configuration](CONFIGURATION.md), [Frontend Architecture](../architecture/FRONTEND.md), and [ADR-0026](../adr/0026-nextjs-bff.md).
