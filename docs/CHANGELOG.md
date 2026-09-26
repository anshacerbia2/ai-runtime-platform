# Changelog

## Unreleased — 26 September 2026 — M0–M2 local implementation closure

Closed the local M0–M2 implementation baseline on top of commit `67c5bf5`: M2 model gateway routes for `chat`, `generate`, `structured_generate`, execution read/cancel and SSE events; OpenRouter + Direct Anthropic adapters; terminal-marker enforcement; structured-output validation; policy-approved `not-sent` fallback with a durable second attempt; database-backed application/connection capacity and rate limits; durable provider invocation/result and usage/accounting evidence. Hardened Zod wire contracts so provider responses are projection-only while generated OpenAPI remains explicitly additive-compatible for consumers. Fresh local evidence: `npm run verify` PASS exit 0, migrations through `0010`, contract 31/31, API unit 35/35, tooling 27/27, PostgreSQL integration 47/47, web/BFF 60/60, and browser E2E 21/21. Authorized live vendor smoke, deployed identity/Redis/secret-manager, M3 agent runtime, and production gates remain pending.

## Unreleased — 24 September 2026 — source-first documentation synchronization

Reviewed all existing repository Markdown against registered routes, physical schema, actual client/UI/BFF behavior and dated verification records. Added current-state and exhaustive HTTP references plus I01–I04 implemented diagrams. Updated architecture, lifecycle, data, configuration, milestones, roadmaps, acceptance scope and ADR implementation notices. Historical adoption/test records remain dated; provider/streaming/sandbox targets are explicitly planned. No application source, migration SQL, generated contract artifact or existing user UI edit is changed by this documentation-only task. Results and complete inventory are in [documentation sync](reviews/DOCUMENTATION-SYNC.md).

## Unreleased — receipt-backed resource APIs and runner authority

Added independent versioned resource operations, bounded keyset lists and count-only overview, atomic request receipts with retained expiry keys, explicit retry ownership and total request budget, typed runner authority messages with durable fencing and late-evidence quarantine, explicit database/wire mappers and serialization AST gate. Additive migrations preserve existing history. The console no longer fetches the legacy full snapshot. Local verification is recorded in [contract execution evidence](reviews/CONTRACT-EXECUTION.md); provider execution and autonomous dispatch remain separate gates.

## Unreleased — 24 September 2026 — HTTP behavior and mutation outcome hardening

Bounded browser/BFF unary reads and waits, removed provider response JSON roundtrip, added additive nested response views while retaining strict command schemas, preserved safe retry/correlation diagnostics, and separated mutation outcome from secondary health state. Added generation fencing for editor/key/scenario changes, explicit unknown write outcomes, and adversarial unit/browser tests. OpenAPI exports shared behavioral metadata. At this earlier hardening checkpoint, no automatic retry, live SSE runtime, end-to-end backend deadline propagation, or production readiness was claimed; the later receipt/resource entry supersedes its retry policy. See [HTTP audit](reviews/HTTP-CONTRACT-AUDIT.md) and [ADR-0028](adr/0028-http-behavior-and-outcome-semantics.md).

## Unreleased — Next.js App Router and server-owned BFF implementation

Replaced the Vite SPA and development credential proxy with Next.js App Router, stable feature URLs, a standalone entry page, and authenticated server-rendered documentation. Implemented confidential OIDC Authorization Code + PKCE/state/nonce verification, opaque signed session references, encrypted Redis-held tokens, coordinated refresh, and app-local logout. Added allowlisted, bounded BFF forwarding with CSRF/host checks; retired proxy-secret authority from the API. Preserved existing CDD components, SCSS tokens, M0 contracts, and M1 data. Added protocol/session/transport/Markdown regression tests and a production client-bundle scan. Live ATI Keycloak and deployed Redis/ingress evidence remain separate from local tests.

## Unreleased — 22 September 2026 — external-app delivery, standalone sign-in, and Next.js BFF

Moved web delivery from ATI One internal-app hosting to an **external app** on the platform's own public origin: mount prefix, per-app proxy credential, and frame-compatibility requirement retired; framing now denied. Authentication becomes a platform-owned entry page with an explicit sign-in action starting an OIDC Authorization Code flow against the shared Keycloak realm whose login UI is served by ai-portal. Adopted Next.js App Router with a Backend-for-Frontend tier owning the confidential client, token custody, session cookie, server-side API forwarding, and server-rendered `docs/` Markdown; tokens no longer reach the browser. NestJS remains the domain API and resource server, and ADR-0024 CDD/token contracts are unchanged.

Added ADR-0025 and ADR-0026; ADR-0023 is partially superseded. Restated gates G36–G38 and added G39. Updated frontend/code-structure/security/deployment/configuration docs. `M1_PROXY_SECRET` is retired and `M1_SESSION_SECRET` added. No runtime or source implementation was changed by this documentation update.

## Unreleased — ATI Portal token + SCSS relayout

Reworked the web console around the ATI Portal token palette and typography/spacing/radius/shadow scales, introduced layered SCSS (`tokens -> foundations -> layouts/components -> features`), retired the legacy CSS bundle, and changed Contract Lab into a responsive three-pane engineering workbench. `ui:check` now scans SCSS as well as CSS/TSX for token bypasses.

## Unreleased — 22 September 2026 — frontend CDD and design-system overhaul

Rebuilt the M0/M1 internal console around the implemented CDD architecture: semantic AI Platform design tokens, shared primitives/components/compositions, grouped product navigation, responsive AppShell/PageHeader, engineering-workbench Contract Lab, resource-based M1 Control Plane, audit-style History, schema catalogue, and de-emphasized delivery reference. Removed duplicate legacy shared UI primitives, added `npm run ui:check` token-bypass enforcement, strengthened desktop/mobile E2E coverage, and kept backend/API behavior unchanged.

## Unreleased — 22 September 2026 — M1 durable foundation local implementation

Implemented the local P1/M1 durable foundation: application/operator/runner identity separation, OIDC/JWKS verification boundary, operator control-plane mutations with CAS/audit, Application/AI Connection/Credential Binding registries, immutable profile revisions/aliases, durable admission/idempotency/execution/attempt/cancel intent, budgets/reservations, usage observations and append-only ledger adjustments, outbox/inbox, artifact metadata, runner pool/node metadata, additive migrations, and local Control Plane UI. Added dedicated M1 unit/integration evidence for G01/G02/G07/G08/G09/G15/G26–G29. Live ATI Keycloak/ATI One, concrete secret-manager, Redis hot runner state, provider/runtime execution, and production readiness remain pending.

## Unreleased — 21 September 2026 — ATI One internal app and frontend CDD

Documented AI Runtime Platform as an ATI One internal app with a dedicated confidential Keycloak client, same-origin mount-path/SSO/proxy trust rules, and separate platform authorization. Added the target frontend architecture: Component-Driven Development, AI Platform semantic design tokens as visual source of truth, layered primitives/components/compositions/features/pages, isolated component states, accessibility, visual regression, and staged migration from M0 hardcoded CSS. Added ADR-0023 and ADR-0024. No runtime/source implementation was changed by this documentation update.

## Unreleased — 21 September 2026 — Fixed stack dan Clean Architecture

Replaced Fastify route monolith with NestJS/Fastify modules, framework-independent use cases and ports, Prisma repositories, and a data-preserving Prisma migration baseline. Split frontend by feature and shared contracts by responsibility. Preserved user Prettier configuration; added ESLint, dependency/cycle checks, typed tests/tooling, and CI verification. Added ADR-0016/0017/0018 documenting framework/ORM selection, reviewer-claim corrections, and quality rules. No provider calls or M1 functionality introduced; M0 remains local-only.

## 0.3.0-m0 — Local Contract Lab — 21 September 2026 (Asia/Jakarta)

Added React/Vite frontend, Fastify backend, shared Zod/types/JSON Schema, active M0 and planned execution OpenAPI, isolated native PostgreSQL bootstrap, repeatable migrations/seed, scoped metadata history, validation idempotency, unit/integration/browser tests and local development guide. ADR-0015 records the testable milestone approach. No AI provider call, plugin execution, real billing or production deployment is enabled. Formal P0 review remains open; test evidence is recorded in [M0](milestones/M0.md).

## Unreleased - ADR reference authority - 20 September 2026

Following the user's removal of the historical review file, active decision references now point to [ADR](adr/README.md). Updated navigation, decision metadata, source/traceability records, and affected documentation; the removed file is not recreated. Prior review history remains in Git and is not an implementation dependency.

This maintenance changes documentation references and authority wording, not functional architecture decisions. ADR adoption still does not imply implementation verification, new reviewer approval, or closed production gates. See [VALIDATION](reviews/VALIDATION.md) for the scope of checks.

## Unreleased - Documentation layout - 20 September 2026

Moved `PLAN.md`, `ROADMAP.md`, and `CHANGELOG.md` from the repository root into `docs/`. Updated references to the architecture document already moved by the user to `docs/architecture/ARCHITECTURE.md`, including relative links inside the relocated documents.

Updated README, documentation index, affected ADR/diagram/review links, and validation records. At this earlier layout-only step the historical review source was left untouched; it was subsequently removed by the user as recorded above. No architecture decisions, execution contracts, diagram source, or runtime implementation changed during relocation.

## 0.2 — 20 September 2026 — Documentation reconciliation and expansion

Updated ARCHITECTURE, PLAN, and ROADMAP to cover agnostic direct/agent execution, app-owned workflow, Managed Execution Envelope, tiered storage, durable budget authority, worker fencing/recovery, and the pre-production Phase 3.5 gate.

Added detailed API/lifecycle/event/profile/tool/artifact/session contracts; data/accounting model; reliability/security/deployment/SLO/runbooks; migration playbook; 14 decision records; 23 numbered Mermaid diagrams plus the architecture overview; acceptance scenarios; glossary; open decisions; source and reconciliation registers; documentation validation record.

Operational clarifications are explicit: completion independent of settlement, rejection-safe durable reservation, atomic settlement/outbox, conditional lease renewal, quarantine/verified late-charge adjustment, multi-turn envelope, stable tool operation keys, and measured gate parameters. These decisions are recorded in ADRs; historical review does not imply retroactive approval of changed revisions.

This release changes documentation only. No application code, runtime adapter, database migration, service deployment, or production test is included. Prior local write/link/diagram checks are recorded in [VALIDATION](reviews/VALIDATION.md), not asserted as runtime readiness.

## 0.1 — Initial documentation

Initial ARCHITECTURE.md, PLAN.md, and ROADMAP.md were committed as `376d435bf43589784b1f1a5d76f88be33b233365`. They established app-owned workflow and shared gateway/runtime/audit direction. Revision 0.2 expands and corrects the operational contracts; it does not erase the earlier Git history.

## 21 September 2026 — platform control and distributed runner requirements

Added ADR-0019–ADR-0022 and synchronized architecture/contracts/plan/roadmap for Application Registry, Keycloak caller identity versus AI Connection identity, dedicated/shared credential binding, central and runner-local secrets, plugin registry with ephemeral materialization, optional workspace/MCP model, distributed runner self-registration/pools/placement, Admin UI fleet visibility, and shared upstream quota groups. These are target architecture decisions; M0 does not claim these capabilities are implemented.

## 21 September 2026 — canonical capability catalogue

Added [CAPABILITIES](contracts/CAPABILITIES.md) as the source of truth for public capability IDs, status vocabulary, execution paths, orthogonal features, publication rules, adapter/runtime support scope, and deferred capability families. Architecture, API, profiles/adapters, plan, roadmap, index, and README now link to the catalogue. M0 remains contract-only; no live capability implementation is implied.

## Shared contracts, inferred clients, and consumer verification

Implemented shared M0/M1 REST route/request/response definitions, contract-bound Nest handlers, inferred browser operations, and explicit BFF exposure. Added real consumer/provider Pact tests, frozen consumer expectations, compile-time negative cases, a disposable Broker compatibility proof in CI, and fail-closed delivery commands. HTTP errors preserve status/correlation and distinguish cancellation/timeout from malformed responses. Health, catalogue, and editor state are independent; closing a banner cannot imply recovery. No provider execution, database schema change, or sign-in/layout redesign is included.
