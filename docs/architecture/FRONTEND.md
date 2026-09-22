# Frontend Architecture — External App, BFF, CDD, and Design Tokens

**Status:** Next.js App Router, the BFF, standalone entry, server-side session/token custody, and authenticated Markdown rendering are implemented. The existing CDD components and SCSS visual system are preserved. Live issuer, Redis deployment, and production operations still require environment-specific evidence.
**Decisions:** [ADR-0024](../adr/0024-component-driven-ui-tokens.md), [ADR-0025](../adr/0025-external-app-standalone-auth.md), [ADR-0026](../adr/0026-nextjs-bff.md). Historic internal-app context: [ADR-0023](../adr/0023-ati-one-internal-app.md), partially superseded.

## 1. Product placement

AI Runtime Platform is an **external application** listed in the ATI One catalogue.

ATI One provides discovery only — a catalogue entry linking to this platform's own public origin. It does not proxy, mount, frame, or authenticate requests. The platform owns its public origin, its full path space from `/`, its application session, its operation-level authorization, its backend API, and its Keycloak OIDC client.

```text
ATI One catalogue
  -> link out
  -> https://<platform-public-origin>/
      -> AI Runtime Platform entry page
         -> sign in with Keycloak
         -> platform console
```

Because the platform is no longer embedded, responses deny framing. The app chrome is the platform's own and does not imitate the portal shell.

## 2. Authentication integration

The platform uses a dedicated confidential Keycloak client against the shared realm whose login interface is served by ai-portal. The flow is standard OIDC **Authorization Code**, run entirely by the BFF.

```text
visitor
  -> platform entry page (unauthenticated)
  -> "Sign in with Keycloak"
  -> Keycloak authorization request
  -> Keycloak login UI (ai-portal deployment)
  -> callback to /auth/callback
  -> BFF exchanges code for tokens
  -> session cookie issued
  -> platform console
```

The platform never renders a credential form and never receives a password. A visitor who already holds a realm session returns from Keycloak without a second prompt, so shared SSO survives without portal hosting.

Tokens stay server-side. The browser receives an opaque session cookie: `Secure`, `HttpOnly`, `SameSite=Lax`, scoped to `/`, and namespaced to this client. Callback and post-logout URIs must match Keycloak registration exactly. These are security invariants.

## 3. Frontend dependency direction

```text
tokens
  -> primitives
  -> components
  -> compositions
  -> features
  -> routes/pages
```

Feature/page code must not be imported into shared component layers.

Orthogonal to that layering is the **execution-context boundary**: server-only code lives under `src/server/` and may use Node built-ins; everything else is client-reachable and may not. Route handlers stay thin and delegate to `src/server/`. No code under `apps/web/` may import Nest, Prisma, or a database driver, in either context.

## 4. Target source shape

Under [ADR-0026](../adr/0026-nextjs-bff.md) the web workspace is a Next.js App Router application:

```text
apps/web/
  next.config.mjs
  src/
    app/                       # App Router: routes and route handlers only
      (public)/
        page.tsx               # entry page with the sign-in action
      (console)/
        layout.tsx             # authenticated shell
        contract-lab/
        control-plane/
        history/
        schemas/
        docs/[...slug]/        # server-rendered docs/ Markdown
      auth/
        login/route.ts         # begins the authorization request
        callback/route.ts      # code exchange, session issue
        logout/route.ts
        logged-out/route.ts
      api/[...path]/route.ts   # authenticated forwarding to apps/api

    server/                    # server-only; Node built-ins permitted here
      auth/                    # OIDC client, code exchange, refresh
      session/                 # cookie sealing, session read/write
      api-gateway/             # server-side calls into apps/api
      docs/                    # sanitized, rooted Markdown reader
      http/                    # origin/CSP policy and bounded transport
      runtime.ts               # server-only composition

    design-system/
      primitives/              # leaf controls such as Button
      components/              # Badge, Panel, MetricCard, DataTable, EmptyState, icons
      compositions/            # AppShell, Sidebar, TopBar, PageRegion, PageHeader

    features/
      contract-lab/
      control-plane/
      history/
      schemas/
      roadmap/

    shared/
      api/                     # typed response parsing
      ui/
      lib/

    styles/
      tokens/                  # raw token source only
      foundations/
      layouts/
      components/
      features/
      main.scss                # single stylesheet entry point
```

Exact names may evolve, but ownership, dependency direction, and the `src/server/` execution boundary must remain equivalent.

`src/server/` is the only directory where Node built-ins are permitted, which is what makes the rule in section 3 mechanically checkable.

## 5. Design-token contract

The **ATI Portal design-token set** is the visual primitive source. AI Runtime Platform maps those primitives into its own semantic token contract before components consume them.

ATI Portal primitive token values are intentionally mirrored as the visual source, but portal React components and portal session/runtime internals are not imported as application dependencies. AI Runtime owns its semantic mapping and component contracts.

The application should expose semantic values to components:

```text
ATI Portal token primitives
  -> AI Runtime semantic application contract
     -> limited component aliases when justified
```

Feature code consumes semantics such as surface, text, action, status, border, focus, spacing, typography, and motion rather than raw visual values.

Outside the token adapter/source, the target is no direct hardcoded colors, spacing, radii, elevation, type scale, motion timing, or z-index.

`apps/web/src/styles/main.scss` is the single stylesheet entry point. ATI Portal design-token values are mirrored in `styles/tokens/_ati.scss`, mapped to application semantics in `_semantic.scss`, then consumed by `foundations`, `layouts`, `components`, and `features` SCSS partials. `npm run ui:check` scans CSS/SCSS/TSX and rejects raw colors, obvious raw spacing/radius/font-size/shadow values, and inline-style bypasses outside token sources.

### Brand core versus working scale

`_ati.scss` holds two layers. The **brand core** — navy family, blue accent, signature gradients — is copied verbatim from the ATI design system and is not hand-tuned locally; it is re-pulled from `ai-portal/frontend/src/design-system/tokens/colors.css` when that source changes. The **working scale** — neutral surfaces, elevation, and status — is owned by this console.

Where the working scale departs from the ATI values, the reason is recorded inline at the token. Two departures are active:

1. **Surfaces are near-neutral** rather than the blue-tinted ATI neutrals, which read as a colour at full-window scale.
2. **Status colours are darkened** from the ATI hues. The source values are tuned for fills; used as badge text on their own soft backgrounds they measure roughly 3.1–3.9:1, short of the WCAG 2.2 AA target in section 8. The hues are unchanged.

Brand presence in this console is the navy heading colour, the navy active-navigation state, and the logo-crossbar gradient on the brand mark. The gradient is used nowhere else; the navigation rail is a white surface, unlike the ATI Portal navy rail.

## 6. Component-Driven Development

### Primitives

Generic and domain-blind:

- Button / IconButton
- Input / Textarea / Select / Checkbox
- Badge / Tag
- Spinner / Skeleton
- Box / Stack / Grid / Text / Divider

Props are leaf values. A primitive does not accept an entire Execution, Runner, Application, Connection, or Model object.

### Reusable components

Examples: FormField, SearchInput, StatusBadge, MetricCard, DataTable, Tabs, Dialog, Drawer, EmptyState, ErrorBanner, Pagination, and CodeEditorFrame.

Feature code may wrap these with domain meaning, but should not fork their base interaction or visual behavior.

### Compositions

Compositions own page regions:

- AppShell
- Sidebar
- TopBar
- PageHeader
- FilterBar
- StatusOverview
- SplitWorkspace
- InspectorPanel
- DetailPanel

Compositions may know navigation/layout context but do not own provider calls or domain mutations.

### Features

Feature modules own queries, mutations, form/domain state, validation, mapping, and orchestration.

### Pages

Routes provide route params/context, compose feature entry points, and define route-level loading/error boundaries. They do not introduce shared visual primitives.

## 7. Isolated component lifecycle

Before broad consumption, reusable interactive components need isolated fixtures for applicable states:

| State          | Coverage                |
| -------------- | ----------------------- |
| Default        | required                |
| Hover          | interactive controls    |
| Focus-visible  | interactive controls    |
| Active/pressed | action controls         |
| Disabled       | when supported          |
| Loading        | async actions           |
| Invalid/error  | form/data validation    |
| Empty          | data-bearing components |
| Selected/open  | selection/disclosure    |
| Narrow/wide    | when anatomy changes    |

The workbench may be Storybook or an equivalent isolated component harness. Architecture requires the capability, not a specific vendor.

Visual regression should start at canonical component states. Whole-page screenshots supplement component checks.

## 8. Accessibility

Target baseline: WCAG 2.2 AA.

- semantic native elements first;
- visible tokenized focus treatment;
- field labels and errors programmatically associated;
- dialogs/drawers manage and restore focus;
- keyboard behavior follows the applicable ARIA pattern;
- status is not conveyed by color alone;
- motion respects reduced-motion preference;
- loading prevents duplicate destructive submission while preserving an accessible name.

Accessibility belongs in reusable components so features inherit it by default.

## 9. Application shell

The previous monolithic M0 workspace shell has been replaced by the implemented `AppShell` composition with product-level navigation groups, a compact top bar, responsive page region, and shared `PageHeader` composition.

```text
<AppShell>
  <Sidebar />
  <AppViewport>
    <TopBar />
    <PageRegion>
      <PageHeader />
      <Feature />
    </PageRegion>
  </AppViewport>
</AppShell>
```

As an external app the platform owns the entire viewport, so the shell is the only chrome and carries product identity, navigation, and session controls. The unauthenticated entry page does not use this shell; it is a separate route group with its own minimal layout.

Presentational components stay client-agnostic. `'use client'` is applied at the smallest boundary that genuinely needs interactivity, not at page roots by default.

## 10. Responsive ownership

Responsive behavior belongs to the smallest layer that owns the decision:

- primitive: intrinsic control sizing/wrapping;
- component: internal anatomy;
- composition: page-region reflow;
- page: route-level composition only.

The app owns a full browser viewport across phone, tablet, and desktop. Use dynamic viewport units where appropriate and avoid accidental nested page scrolling.

## 11. BFF boundary

The BFF is a session and forwarding tier, not a second backend. It owns the confidential client, code exchange, refresh, the session cookie, server-side API calls, and the `docs/` Markdown reader. It owns no domain logic, no validation authority, and no database access.

```text
browser --session cookie--> Next.js BFF --bearer token--> NestJS API --> PostgreSQL
```

A route handler that does more than authenticate, shape, and forward belongs in `apps/api`. See [ADR-0026](../adr/0026-nextjs-bff.md).

## 12. Quality gates

Frontend checks include typecheck/lint, dependency direction including the `src/server/` execution boundary, `npm run ui:check`, browser flow coverage for Contract Lab/History/Schema/Control Plane, phone overflow checks, desktop/mobile screenshots, semantic focus handling, reduced-motion handling, and production build checks.

Two checks are added by the BFF tier: the client bundle must contain no client secret, and no token may be observable in browser storage or response bodies. Live Keycloak sign-in, callback/logout registration, and session behavior remain nonlocal G36–G37 evidence; see [ACCEPTANCE](../testing/ACCEPTANCE.md).

## 13. Migration status

The CDD/token migration is complete and survives the framework change: legacy shared Button/Panel/Badge/PageHeading/StatusOverview/WorkspaceShell implementations were removed, product navigation moved to `AppShell`, all current feature surfaces consume the shared design-system layer, and the visual source sits behind semantic tokens. The SCSS layer transfers to Next.js unchanged.

The Vite entry, proxy, and dependencies have been removed. Existing feature pages now have stable App Router URLs, reload/back navigation, and progressive native navigation links. The public entry and authenticated documentation routes render on the server; shared controls remain client components only where interactive. The real Keycloak client registration, Redis availability/rotation/restore, ingress TLS, and rollout evidence remain deployment work. Future M2/M3 feature UI must extend them instead of reintroducing page-level primitives.

## Non-goals

This design does not make ATI One a runtime dependency, reintroduce portal session sharing, move domain logic into the BFF, require micro-frontends, dictate backend capability contracts, or require one specific component-workbench vendor.
