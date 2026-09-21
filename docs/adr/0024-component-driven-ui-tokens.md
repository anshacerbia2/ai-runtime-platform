# ADR-0024 — Component-Driven Frontend and AI Platform Design Tokens

**Date:** 21 September 2026
**Status:** implemented locally; external ATI One visual/integration evidence remains separate
**Scope:** AI Runtime Platform frontend architecture and visual-system consumption

## Context

M0 Contract Lab proves product flow, but its current `apps/web/src/styles.css` contains hardcoded page/component visual values. That is acceptable as a prototype artifact, not as the production frontend architecture.

As the UI grows into application registry, connection/model management, runtime operations, tools/plugins, evaluation, usage, and observability, page-specific CSS would create divergent controls and expensive accessibility/design fixes.

The visual source of truth is the **AI Platform design-token contract**. ATI One defines hosting/integration, not this product's visual-token authority.

## Decision

AI Runtime Platform SHALL use **Component-Driven Development (CDD)** with token-strict styling.

```text
AI Platform design tokens
  -> primitives
  -> reusable components
  -> compositions
  -> feature components
  -> pages/routes
```

### Token source of truth

Application/component code SHALL NOT introduce raw visual values for:

- color;
- spacing;
- radius;
- elevation;
- typography scale;
- motion duration/easing;
- z-index.

Raw values belong only in the token source/adapter that imports or compiles the AI Platform token contract.

The original M0 hardcoded stylesheet has been migrated. The canonical raw visual values now live only in `apps/web/src/design-system/tokens/tokens.css`; the rest of the frontend consumes semantic tokens.

Components consume semantic roles such as:

```text
surface.canvas
surface.panel
surface.navigation
text.primary
text.secondary
border.default
action.primary
status.success
status.warning
status.danger
focus.ring
```

### Primitive boundary

Primitives are generic, accessible, and domain-blind.

Representative primitives:

- Box / Stack / Grid / Text
- Button / IconButton
- Input / Textarea / Select / Checkbox
- Badge / Tag
- Divider
- Spinner / Skeleton

Primitives accept leaf-value props and SHALL NOT receive domain entities such as Execution, Application, Connection, Model, or Runner.

### Reusable components

Reusable components compose primitives into stable contracts, for example FormField, SearchInput, StatusBadge, MetricCard, EmptyState, DataTable, Tabs, Dialog, Drawer, Pagination, ErrorBanner, and CodeEditorFrame.

Feature teams reuse these contracts instead of creating feature-specific versions of generic controls.

### Composition, feature, and page ownership

Compositions own page regions such as AppShell, Sidebar, TopBar, PageHeader, FilterBar, StatusOverview, SplitWorkspace, InspectorPanel, and DetailPanel.

Features own domain-facing queries, mutations, form state, validation, mapping, and orchestration.

Pages/routes primarily provide route context and compose feature entry points. They do not define new shared primitives or repeated visual rules.

### Component-first workflow

Reusable components are verified in isolation before broad feature use. Applicable states include default, hover, focus-visible, active/pressed, disabled, loading, invalid/error, empty, selected/open, and narrow/wide layouts where anatomy changes.

The isolated harness may be Storybook or an equivalent tool; the capability is required, the vendor is not.

### Accessibility and responsive ownership

Target baseline is WCAG 2.2 AA. Semantic HTML, keyboard behavior, focus management, labels/error association, and ARIA state belong to reusable component contracts rather than page-level patches.

Responsive behavior belongs to the smallest layer that owns the layout decision:

- primitive: intrinsic control behavior;
- component: internal anatomy;
- composition: page-region reflow;
- page: route-level composition only.

## Alternatives considered

- Keep page-level CSS as the long-term model.
- Copy ATI One portal components as this product's design system.
- Permit raw values and rely only on review.
- Build complete pages first and extract components later.

These options were not selected because they increase drift or invert the component-first workflow.

## Consequences

CDD reduces visual drift and centralizes accessibility and interaction behavior. It also requires staged M0 migration, deliberate component APIs, isolated rendering, visual regression, and CI enforcement.

## Verification

The frontend quality gate should detect:

1. raw visual literals outside the token adapter/source;
2. duplicated generic controls where a shared primitive/component exists;
3. reusable interactive components without state/accessibility coverage;
4. reusable primitive implementations embedded in route/page files;
5. unresolved or missing token contract imports.

Visual regression should focus first on canonical component states; whole-page screenshots supplement rather than replace component tests.

## Related documentation

- [Frontend Architecture](../architecture/FRONTEND.md)
- [Code Structure](../architecture/CODE-STRUCTURE.md)
- [Implementation Plan](../PLAN.md)

## Revisit trigger

Revisit if the AI Platform token contract or frontend framework changes materially. CDD and semantic token consumption remain principles even if the concrete toolchain changes.
