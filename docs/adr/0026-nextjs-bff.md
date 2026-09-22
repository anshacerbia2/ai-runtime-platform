# ADR-0026 — Next.js App Router and Backend-for-Frontend Tier

**Date:** 22 September 2026
**Status:** implemented locally; live issuer and deployed session-store evidence remain separate
**Scope:** web application framework, server tier ownership, and token custody

## Context

At adoption, `apps/web` was a Vite single-page application: a static bundle with no server of its own. Two requirements cannot be met inside that shape.

**Confidential-client custody.** [ADR-0025](0025-external-app-standalone-auth.md) requires an OIDC Authorization Code flow with a confidential client. Code exchange, client secret custody, refresh, and session cookies all require a server owned by the web tier. A static bundle has none, which leaves only two bad options: put the flow in the browser (the secret leaks and the grant type degrades), or put it in the NestJS API (the domain API acquires browser-session concerns and a second authentication model).

**Server-side document rendering.** `docs/` holds roughly seventy Markdown records — ADRs, architecture, contracts, operations. Surfacing them in the console means reading the filesystem at build or request time. A Vite build would require a glob plugin and ship a Markdown parser to every visitor.

[SECURITY.md](../security/SECURITY.md) already lists `client/BFF -> API` among the system's trust boundaries. The BFF tier was assumed by the existing security model but was not yet implemented at adoption.

## Decision

`apps/web` SHALL be a **Next.js application using the App Router**, containing a **Backend-for-Frontend (BFF)** tier.

```text
browser
  -> Next.js (apps/web)          # rendering + BFF: session, token custody, forwarding
     -> NestJS/Fastify (apps/api) # domain API and OAuth resource server
        -> PostgreSQL
```

### BFF responsibilities

The BFF owns, and is the only tier that owns:

- the confidential OIDC client and its secret;
- authorization-code exchange, `state`/PKCE verification, and token refresh;
- the session cookie defined in ADR-0025;
- attaching the access token to API calls server-side;
- reading `docs/` Markdown for the documentation surface.

**Access and refresh tokens never reach the browser.** The browser holds an opaque session cookie and nothing else.

### BFF non-responsibilities

The BFF SHALL NOT contain domain logic, business rules, validation authority, or database access. It has no Prisma client and no direct PostgreSQL connection. Every domain read or write is a call to the NestJS API.

A route handler that does more than authenticate, shape, and forward belongs in `apps/api`.

### API tier unchanged

NestJS with Fastify remains the domain API ([ADR-0016](0016-nestjs-fastify.md)) and acts as an **OAuth resource server**, validating JWTs against the realm JWKS exactly as it does now. It does not gain session, cookie, or login-flow responsibility. The Clean Architecture boundaries of [ADR-0018](0018-clean-architecture-quality.md) are untouched.

### Internal hop authentication

The browser-to-BFF hop is authenticated by the session cookie. The BFF-to-API hop is authenticated by the bearer access token the BFF holds for that session. The API applies the same per-operation authorization regardless of caller, so the BFF is a client with no additional privilege — it cannot assert identity the token does not carry.

This replaces, and is stricter than, the retired network-position proxy check: the second hop now carries a verifiable principal rather than a shared secret.

### Design system preserved

[ADR-0024](0024-component-driven-ui-tokens.md) is unaffected. CDD layering, semantic tokens, and the primitives/components/compositions boundary are framework-independent, and that ADR already declines to mandate a vendor. The SCSS layer transfers unchanged; Next.js compiles Sass natively.

Presentational components remain client-agnostic. `'use client'` is applied at the smallest boundary that requires interactivity, not at page roots by default.

### Dependency rule change

Before this migration, `scripts/lib/dependency-rules.mjs` forbade any `node:` import beneath `apps/web/`. That rule was correct while the workspace was entirely browser code; it would now reject the BFF and the Markdown reader by construction.

The rule SHALL be narrowed from _workspace path_ to _execution context_: client components may not import backend infrastructure, while server-only modules may use Node built-ins. Server-only modules are confined to designated directories so the rule stays mechanically checkable, and the prohibition on Prisma, Nest, and direct database drivers under `apps/web/` remains absolute.

## Alternatives considered

- **Keep Vite; put the OIDC flow in NestJS.** Rejected: the domain API acquires cookie/session/redirect concerns and a second authentication model alongside its resource-server role, and the documentation surface remains unsolved.
- **Keep Vite; add a small dedicated BFF service.** Rejected: a third deployable and a third build pipeline to avoid a framework the web tier would benefit from anyway; server rendering of documents would still need separate work.
- **Next.js static export (`output: 'export'`).** Rejected: no server, so it solves neither requirement — it is the current Vite situation with heavier tooling.
- **Remix or TanStack Start.** Not rejected on merit; both satisfy the requirements. Next.js is selected for ecosystem familiarity and because no requirement distinguishes them. This is a preference, recorded as one.
- **Move `docs/` rendering to a separate documentation site.** Rejected: the console is where operators already are, and the records are versioned with the code.

## Consequences

The deployment gains a second Node process, so topology, health checks, and the development runner change; this is recorded in [DEPLOYMENT](../operations/DEPLOYMENT.md). Local development moves from Vite HMR to the Next.js dev server.

A BFF tier creates a standing risk of business logic accumulating in route handlers. The non-responsibilities above exist to be enforced, not merely stated, and belong in review.

Tooling affected: `scripts/dev.mjs` (previously spawned Vite; now launches the Next.js web runner), `scripts/check-ui-tokens.mjs` (hardcodes `apps/web/src`), `scripts/lib/dependency-rules.mjs`, `apps/web/package.json`, `playwright.config.ts`, and `config/hosting.mjs`. None of these are load-bearing for domain correctness.

Server-rendered Markdown means `docs/` becomes a build input for `apps/web`. Content changes affect the web build, and broken links surface as build failures as well as `docs:check` failures.

## Verification

1. No access or refresh token is observable in browser storage, JavaScript state, or any response body.
2. The confidential client secret is absent from the client bundle; a build-output scan proves it.
3. A request to a BFF route without a valid session is rejected before any API call is made.
4. The BFF holds no Prisma client and opens no database connection.
5. Client components do not import Node built-ins; server-only modules may.
6. `npm run ui:check` passes against the Next.js source layout.
7. The documentation surface renders `docs/` Markdown without shipping a Markdown parser to the browser.
8. Token expiry triggers refresh server-side without a visible re-authentication.

## Related documentation

- [ADR-0025](0025-external-app-standalone-auth.md)
- [ADR-0016](0016-nestjs-fastify.md)
- [ADR-0018](0018-clean-architecture-quality.md)
- [ADR-0024](0024-component-driven-ui-tokens.md)
- [Frontend Architecture](../architecture/FRONTEND.md)
- [Code Structure](../architecture/CODE-STRUCTURE.md)

## Revisit trigger

Revisit if the BFF accumulates domain responsibility that belongs in the API, if server rendering stops being required, or if the App Router's stability or upgrade cost changes the trade materially.

## Implementation record

The web workspace now uses Next.js App Router with thin route handlers under `src/app/` and server-only code under `src/server/`. The existing React/CDD components and SCSS are retained. The Vite entry, configuration, and dependencies are removed.

Session storage is an explicit Redis dependency of the nonlocal BFF only, not a direct connection to the domain PostgreSQL database. Tokens are encrypted in server records; the browser receives only a signed opaque reference. Local fixtures and test memory stores are never a nonlocal runtime fallback.

Verification and rollout instructions: [Web/BFF Operations](../development/WEB.md). The current local test evidence is recorded in [Validation](../reviews/VALIDATION.md). Live issuer, Redis deployment, key rotation, and operational sign-off remain distinct deployment evidence.
