# ADR-0023 — ATI One Internal-App Integration

**Date:** 21 September 2026
**Status:** partially superseded by [ADR-0025](0025-external-app-standalone-auth.md) on 22 September 2026
**Scope:** web delivery, authentication, and portal trust boundary

> **Supersession notice.** The product moved to external-app delivery before this decision was implemented, which is the second condition in the revisit trigger below.
>
> **No longer in force:** internal-app hosting, the `/apps/<app-id>/app` mount path, per-app proxy-origin verification (`X-ATI-One-Proxy`), mount-scoped cookie paths, and the frame-compatibility requirement — which ADR-0025 inverts to deny framing.
>
> **Still in force:** the dedicated confidential Keycloak client, server-side token exchange, the rejection of portal-client reuse and portal-cookie sharing, cookie namespacing and isolation, and the authorization boundary separating portal entitlement from platform operation authorization.
>
> The retired contract is kept here rather than deleted so that a return to portal-hosted delivery is a documented path.

## Implementation reconciliation — 24 September 2026

Retired internal-app requirements below are historical, not the implemented delivery path. The code uses standalone Next.js/BFF, root-scoped session and frame denial under ADR-0025/0026. See [current source state](../implementation/CURRENT-STATE.md), [active HTTP operations](../implementation/HTTP-API.md), and [verification scope](../reviews/CONTRACT-EXECUTION.md). This note updates implementation status only; it does not create new reviewer approval or erase the original decision history.

## Context

AI Runtime Platform will be delivered as an **internal application inside ATI One**. It is not an ATI One shell replacement and not a Keycloak theme.

ATI One owns catalogue visibility and the outer entitlement decision for opening the product. AI Runtime Platform remains independently deployable and owns its own frontend, backend, application session, operation-level authorization, and dedicated Keycloak OIDC client.

The browser-facing route follows the ATI One internal-app contract:

```text
browser
  -> https://<ati-one-origin>/apps/<app-id>/app/*
  -> ATI One entitlement + reverse proxy
  -> AI Runtime Platform upstream
```

Shared SSO comes from the common Keycloak realm, not from sharing ATI One session cookies.

## Decision

### Internal-app hosting

- Public mount path: `/apps/<app-id>/app`.
- Browser routes, assets, OIDC callbacks, logout URIs, and generated absolute URLs MUST preserve that prefix.
- Upstream deployment may move without changing the public route contract.
- The mounted app remains frame-compatible with ATI One and MUST NOT use `X-Frame-Options: DENY` or `frame-ancestors 'none'`.

### Dedicated Keycloak client

AI Runtime Platform SHALL use its own confidential OIDC client.

- Authorization Code flow; token exchange stays server-side.
- Client secret is owned by this deployment.
- Redirect, post-logout, and front-channel logout URIs are derived from ATI One's public origin plus the mount path.
- Claims/scopes are explicitly assigned per client.
- The ATI One portal client is never reused.
- Provider credentials never enter the browser.

A representative client-id convention is `<app-id>-app`.

### SSO behavior

On entry the app SHOULD probe the existing realm session with `prompt=none`.

- Existing Keycloak SSO session: establish the app session without a second login screen.
- No realm session: escape the iframe before interactive login so Keycloak renders in the top-level browsing context.
- ATI One and AI Runtime Platform keep separate application sessions.

### Authorization boundary

```text
ATI One
  -> may this principal open this catalogue product?

AI Runtime Platform
  -> may this authenticated principal perform this platform operation?
```

Portal entitlement MUST NOT replace platform authorization.

### Proxy-origin trust

Every non-health upstream route SHALL validate the per-app ATI One proxy credential (currently `X-ATI-One-Proxy`). A liveness endpoint may be exempt only when it returns non-sensitive health information.

### Cookie isolation

Application cookies SHALL:

- be namespaced to this app/client;
- use `Secure`, `HttpOnly`, and appropriate `SameSite`;
- use `Path=/apps/<app-id>/app` where compatible;
- avoid ATI One reserved names and library-default names likely to collide.

Path scoping is an operability/header-size control, not a security boundary.

## Rejected alternatives

- Reuse the ATI One portal Keycloak client.
- Share the ATI One portal session cookie.
- Treat ATI One product entitlement as platform operation authorization.
- Default to a separate public hostname for an app intended to remain in the internal-app tier.

These options increase coupling, weaken isolation, or break the existing same-origin SSO model.

## Verification

Before non-local deployment, browser/integration tests SHALL prove:

1. routes and assets work under the mounted prefix;
2. callback/logout URIs exactly match Keycloak registration;
3. existing SSO signs in silently;
4. missing SSO escapes the frame before interactive login;
5. cookies are namespaced and path-scoped;
6. direct upstream requests without the proxy credential are rejected;
7. opening/signing out of this app does not destroy ATI One's session;
8. app logout clears only the intended application session;
9. an authenticated but unauthorized principal is still denied by platform authorization.

## Related documentation

- [Frontend Architecture](../architecture/FRONTEND.md)
- [Code Structure](../architecture/CODE-STRUCTURE.md)
- [Deployment](../operations/DEPLOYMENT.md)
- [Security](../security/SECURITY.md)

## Revisit trigger

Revisit only if ATI One changes its internal-app contract, the app intentionally moves to another delivery tier, or the shared Keycloak-realm model changes.

The second condition fired on 22 September 2026; see [ADR-0025](0025-external-app-standalone-auth.md).
