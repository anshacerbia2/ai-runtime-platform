# ADR-0025 — External-App Delivery and Standalone Authentication Entry

**Date:** 22 September 2026
**Status:** adopted in documentation
**Scope:** web delivery tier, portal relationship, and authentication entry point
**Supersedes:** [ADR-0023](0023-ati-one-internal-app.md) internal-app hosting, mount-path, proxy-origin, and frame-compatibility decisions. ADR-0023 retains authority for the dedicated confidential client, authorization boundary, and cookie-isolation principles.

## Context

ADR-0023 placed AI Runtime Platform inside ATI One as an **internal application**: mounted under `/apps/<app-id>/app`, reached through the ATI One reverse proxy, framed by the portal, and gated by a per-app proxy credential.

That decision has not been implemented. `config/hosting.mjs` encodes the mount/proxy/cookie contract and `config/environment.mjs` validates the `m1-oidc` variables, but no upstream, proxy, or session tier consumes them. Nothing is being discarded except an unexercised design.

The product now requires its own public entry: a landing page the platform controls, with an explicit sign-in action, reachable without passing through the portal. ATI One remains the catalogue where the product is discovered, but it becomes a link target rather than a hosting tier.

Its own revisit trigger authorises this change: ADR-0023 is revisited when _"the app intentionally moves to another delivery tier."_

The shared Keycloak realm is unchanged. Its login interface is served by ai-portal, which already runs in production, and that deployment is the issuer this platform authenticates against.

## Decision

### Delivery tier

AI Runtime Platform SHALL be delivered as an **external application** registered in the ATI One catalogue.

```text
ATI One catalogue
  -> link to https://<platform-public-origin>/
  -> AI Runtime Platform entry page
     -> Keycloak authorization request
     -> platform session
```

- The platform serves its own public origin and owns its full path space from `/`.
- ATI One does not proxy, mount, frame, or terminate requests for this application.
- The `/apps/<app-id>/app` mount prefix is retired. Routes, assets, callback URIs, and cookies are rooted at `/`.
- The per-app ATI One proxy credential (`X-ATI-One-Proxy`) is retired as a request-admission control. No route validates it.

### Frame posture

As an external application the platform is no longer embedded by the portal. The frame-compatibility requirement in ADR-0023 is **inverted**: responses SHALL deny framing (`frame-ancestors 'none'`), restoring clickjacking protection that internal-app hosting had required the platform to give up.

### Authentication entry

The platform SHALL present an unauthenticated entry page containing an explicit sign-in action. Selecting it begins an OIDC **Authorization Code** flow against the shared Keycloak realm.

- The platform does not render a credential form and never receives a user password.
- Resource Owner Password Credentials / Direct Access Grant is rejected.
- The login interface is Keycloak's, served by the ai-portal production deployment.
- Redirect, post-logout, and front-channel logout URIs are derived from the platform's own public origin.
- A user with an existing realm session is returned without a second credential prompt, so shared SSO survives the tier change without portal hosting.

Silent `prompt=none` probing remains permitted as an optimisation for returning users but is no longer required, because there is no frame to escape from.

### Session ownership

The platform owns its application session independently of ATI One. Cookies SHALL be namespaced to this client, `Secure`, `HttpOnly`, `SameSite=Lax`, and scoped to `/`. ATI One session cookies are never read or reused. This is unchanged from ADR-0023 in intent; only the path scope changes.

### Authorization boundary

Unchanged from ADR-0023 and restated because the entry path moved:

```text
ATI One catalogue
  -> product discovery only; no entitlement decision reaches this platform

AI Runtime Platform
  -> may this authenticated principal perform this platform operation?
```

Because ATI One no longer proxies requests, portal entitlement is **not** an input to platform access at all. Every access decision is the platform's own.

### Environment contract

The `m1-oidc` runtime mode is retained with changed semantics:

- `M1_PUBLIC_ORIGIN` becomes the platform's own public origin, not the portal's.
- `M1_APP_ID` identifies the catalogue entry and the client-id convention. It no longer derives a mount path.
- `M1_OIDC_CALLBACK_URI` / `M1_OIDC_LOGOUT_URI` resolve under the platform origin at `/auth/callback` and `/auth/logged-out`.
- `M1_PROXY_SECRET` is retired.
- `M1_OIDC_ISSUER`, `M1_OIDC_AUDIENCE`, and `M1_OIDC_JWKS_URI` point at the Keycloak deployment fronted by ai-portal.

## Required controls for a shared production issuer

Authenticating against a production Keycloak from non-production deployments is a deliberate trade and carries obligations that are part of this decision, not caveats to it:

1. Each environment SHALL use a distinct client id and secret. A single client shared across environments is rejected.
2. Loopback and non-production redirect URIs SHALL NOT be registered on a client used by the production deployment.
3. A production client secret SHALL NOT be placed in a developer workstation `.env`.
4. Local development continues to run `m0-local` mode with local credentials and contacts no production issuer.

If these cannot be satisfied, a separate non-production realm or client is required before non-local work proceeds.

## Alternatives considered

- **Remain an ATI One internal app (ADR-0023 as written).** Rejected: the product requires an entry page and session it controls, and internal-app hosting forces the platform to accept framing.
- **Credential form in the application using Direct Access Grant.** Rejected: the platform would handle raw passwords, MFA and account recovery would regress, and the grant is discouraged in current OAuth guidance.
- **Self-hosted identity without Keycloak.** Rejected: duplicates password storage, recovery, lockout, and MFA that the realm already provides, and conflicts with [ADR-0019](0019-application-connections-credentials.md).
- **Leave ATI One registration entirely.** Rejected: catalogue discovery is still wanted; only the hosting tier is in question.

## Consequences

Retiring the proxy credential removes a network-position control, so authentication and per-operation authorization now carry the entire access decision — they were always required, but no longer sit behind a second gate. Denying framing is a net security improvement. Losing the mount prefix simplifies routing, asset paths, and cookie scope.

ADR-0023's verification items 1, 4, 5, 6, and 7 no longer apply as written; items 2, 3, 8, and 9 survive against the new origin. Acceptance gates G36 and G37 are restated in [ACCEPTANCE](../testing/ACCEPTANCE.md).

Returning to internal-app hosting later means re-introducing mount-prefix handling and proxy verification. The contract is preserved in ADR-0023 and in this record rather than deleted, so that reversal is a documented path.

## Verification

Before non-local deployment, browser/integration tests SHALL prove:

1. the entry page renders unauthenticated and exposes exactly one sign-in action;
2. the sign-in action reaches Keycloak with the registered client and redirect URI;
3. callback and post-logout URIs exactly match Keycloak registration under the platform origin;
4. an existing realm session returns the user without a second credential prompt;
5. cookies are namespaced, `Secure`, `HttpOnly`, and scoped to `/`;
6. responses deny framing;
7. platform logout clears only the platform session and leaves the realm session policy-appropriate;
8. an authenticated but unauthorized principal is still denied by platform authorization;
9. no route grants access on the basis of a proxy header.

## Related documentation

- [ADR-0023](0023-ati-one-internal-app.md)
- [ADR-0026](0026-nextjs-bff.md)
- [Frontend Architecture](../architecture/FRONTEND.md)
- [Security](../security/SECURITY.md)
- [Deployment](../operations/DEPLOYMENT.md)
- [Configuration](../development/CONFIGURATION.md)

## Revisit trigger

Revisit if the product returns to portal-hosted delivery, if the shared Keycloak realm or its ai-portal-served login interface changes ownership, or if a non-production realm becomes available and changes the issuer topology.
