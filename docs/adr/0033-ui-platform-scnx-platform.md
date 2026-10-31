# ADR-0033 — UI Platform packages and the scnx-platform theme as the visual source

**Date:** 31 October 2026
**Status:** implemented locally; partially supersedes [ADR-0024](0024-component-driven-ui-tokens.md) (its visual primitive source only)
**Basis:** [ADR-0024](0024-component-driven-ui-tokens.md), [ADR-0026](0026-nextjs-bff.md), [Frontend Architecture](../architecture/FRONTEND.md).

## Context

ADR-0024 made the ATI Portal design-token set the visual primitive source, mirrored into `apps/web/src/styles/tokens/_ati.scss` and mapped through `_semantic.scss`. Since then the Scnehaux platform has a published UI Platform: `@scnx/system` and `@scnx/core-ui`, built and attested by `anshacerbia2/ui-platform`, with the `scnx-platform` theme as the platform's own look. Identity Experience, Organization Experience and the UI Platform documentation site draw with it, and a person moves between those consoles and this one. Drawing this console from a separate token set makes it the one product that looks different, and keeps a second copy of values the platform already owns.

## Decision

The visual primitive source is the UI Platform's `scnx-platform` theme. Everything else in ADR-0024 stays in force: component-driven development, the semantic token contract, the dependency direction, strict token consumption and the quality gates.

```text
@scnx/system scnx-platform tokens (--ds-color-*, --ds-dimension-*, --ds-typography-*, ...)
  -> AI Runtime semantic tokens (_semantic.scss: --ds-surface-*, --ds-text-*, --ds-space-*, ...)
  -> primitives -> components -> compositions -> features -> routes
```

- **Intake.** The packages are not on npm yet. `vendor/ui-platform/` holds the two tarballs of one ui-platform CI run on `main`, byte-identical to the ones Identity Experience and Organization Experience pin, and `vendor/ui-platform/pin.json` records the repository, the commit, the run and each tarball's sha256. `apps/web/package.json` installs exactly those files; `scripts/check-ui-platform.mjs` (`npm run ui:platform`, part of `verify`) holds the files to the pin.
- **Theme root.** `<html>` carries `data-scnx-theme="scnx-platform"` and `data-scnx-resolved-mode`, the attributes the theme stylesheet selects on (`STD-UIP-TKN-002` §3.4). The root layout renders them on the server from the `ai-runtime-mode` cookie (dark until the viewer chooses), so the first paint has tokens and no flash. The top bar's mode switch sets the attribute and the cookie together.
- **Semantic adapter.** `_ati.scss` is replaced by `_platform.scss`, which points the console's own scale names (radius, elevation, motion, type) at `scnx-platform` tokens and keeps the spacing steps the platform has no scale for. `_semantic.scss` maps every AI Runtime semantic role onto a `scnx-platform` token or an OKLab mix of one. Components keep consuming the semantic roles; no component reads a raw value.
- **Drawing.** The console is drawn as the UI Platform documentation site and the Identity and Organization consoles are, after the theme's brand book (scnehaux-design `scnx-platform/Brand-Book.html`): square, one line between any two areas, blue only for the current place, Inter for content and IBM Plex Mono for labels, figures and identifiers.
- **Layers.** The platform's stylesheets declare `reset, tokens, base, components, recipes, utilities, overrides`. This application's reset joins `reset`, and the rest of its stylesheet sits in an `app` layer after the platform's, so an application rule never needs specificity to win and the platform's component rules are never overridden by an unlayered element rule.

## Alternatives considered

- Keep the ATI Portal tokens. Rejected: the console would remain the only Scnehaux product that looks different, and two sources would drift.
- Copy the UI Platform's token values into the local token source. Rejected: a copy drifts from the published theme and loses its contrast evidence and provenance.
- Replace every component with the platform's at once. Rejected for this step: the semantic adapter re-skins the existing CDD components with no behaviour change; individual components move to the platform's as their contracts allow.

## Consequences

The console looks like the rest of the platform, and a theme change in the UI Platform reaches it through a pin change. Radius is 0 in `scnx-platform`, so every radius role resolves square. The ATI Portal visual source is no longer mirrored here; ATI One catalogue linking and authentication (ADR-0025) are unaffected.

## Verification

- `npm run ui:platform` checks the vendored tarballs against the pin.
- `npm run ui:check` still rejects raw visual literals outside `styles/tokens/`.
- `npm run verify` and `npm run test:e2e` pass unchanged.

## Revisit trigger

Revisit when the UI Platform publishes to a registry (the pin then moves to the registry version), when it ships a component that replaces a local one here, or when the platform's theme contract changes.

## Affected documents

[Frontend Architecture](../architecture/FRONTEND.md) §5, [ADR-0024](0024-component-driven-ui-tokens.md), [ADR index](README.md).
