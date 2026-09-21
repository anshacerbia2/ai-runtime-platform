# Frontend Architecture — ATI One Internal App, CDD, and Design Tokens

**Status:** target architecture; M0 Contract Lab remains a transitional implementation.
**Decisions:** [ADR-0023](../adr/0023-ati-one-internal-app.md), [ADR-0024](../adr/0024-component-driven-ui-tokens.md).

## 1. Product placement

AI Runtime Platform is an **ATI One internal application**.

ATI One provides the outer catalogue, entitlement gate, same-origin mount, and reverse proxy. AI Runtime Platform owns its own application UI, application session, operation-level authorization, backend APIs, and Keycloak OIDC client.

```text
ATI One shell
  -> catalogue / entitlement
  -> /apps/<app-id>/app/*
      -> AI Runtime Platform app shell
         -> platform features
```

The platform does not render the ATI One shell again inside itself. Its own chrome is limited to navigation and controls required by AI Runtime Platform.

## 2. Authentication integration

The internal app uses a dedicated confidential Keycloak client and follows the ATI One internal-app mount-path/session rules in ADR-0023.
Normal entry:

```text
ATI One authenticated user
  -> internal app mount
  -> silent OIDC probe (prompt=none)
  -> existing Keycloak realm session
  -> app session established
  -> platform authorization
```

If no realm session exists, interactive authentication runs in the top-level window rather than inside the frame.

Mount path, callback/logout URI, cookie namespace/path, and ATI One proxy verification are security and operability invariants.

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

## 4. Target source shape

The current source can migrate incrementally toward:

```text
apps/web/src/
  app/
    routing/
    providers/
    bootstrap/

  design-system/
    tokens/
    primitives/
    components/
    compositions/
    testing/
    index.ts

  features/
    contract-lab/
    applications/
    connections/
    models/
    runtime/
    agents/
    tools/
    evaluations/
    usage/
    operations/

  shared/
    api/
    auth/
    lib/
```

Exact names may evolve, but ownership and dependency direction must remain equivalent.

## 5. Design-token contract

The **AI Platform design-token contract** is the visual source of truth.

ATI One tokens/components are not copied into this application merely because ATI One hosts it. Portal integration and product visual identity are separate concerns.

The application should expose semantic values to components:

```text
AI Platform token primitives
  -> semantic application contract
     -> limited component aliases when justified
```

Feature code consumes semantics such as surface, text, action, status, border, focus, spacing, typography, and motion rather than raw visual values.

Outside the token adapter/source, the target is no direct hardcoded colors, spacing, radii, elevation, type scale, motion timing, or z-index.

The existing M0 `apps/web/src/styles.css` is transitional. It records prototype intent but is not a token authority.

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

The current M0 workspace has useful operational density, but the target shell should be componentized rather than one large workspace component.

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

When hosted in ATI One, avoid a redundant outer product header that competes with the portal. The internal shell identifies AI Runtime Platform and supplies platform navigation, not a second ATI One shell.

## 10. Responsive ownership

Responsive behavior belongs to the smallest layer that owns the decision:

- primitive: intrinsic control sizing/wrapping;
- component: internal anatomy;
- composition: page-region reflow;
- page: route-level composition only.

The app must work in both the normal ATI One internal-app viewport and ATI One's expanded internal-app view. Use dynamic viewport units where appropriate and avoid accidental nested page scrolling.

## 11. Quality gates

Target frontend checks include typecheck/lint, dependency direction, token-bypass linting, component behavior tests, isolated accessibility tests, component visual regression, ATI One mount-prefix browser tests, OIDC silent-login/logout tests, responsive embedded/expanded tests, and production build/bundle checks.

## 12. M0 migration rule

Do not freeze platform work for a one-shot CSS rewrite. New reusable UI follows this architecture immediately; existing selectors migrate incrementally when touched.

A migrated area has equivalent behavior, isolated component-state coverage, reviewed visual parity, semantic-token/component consumption, and no obsolete page-level rules.

## Non-goals

This design does not share ATI One session internals, make ATI One a runtime UI dependency, require micro-frontends, dictate backend capability contracts, or require one specific component-workbench vendor.
