# Changelog

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
