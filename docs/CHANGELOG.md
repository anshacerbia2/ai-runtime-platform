# Changelog

## Unreleased — 22 October 2026 — credentials bound to gateway connections

Added explicit per-connection credential resolution to both provider adapters, preserving server-selected credential identity/revision and rechecking current PostgreSQL authority before/after lookup. Deployment-injected bindings support multiple accounts on one provider; nonlocal global legacy keys fail closed. Abort/lookup failures deny transport without exposing secret-source errors, and provider redirects are refused. Existing invocation/usage/ledger identities retain connection attribution and replay deduplication. Configuration/unit and PostgreSQL/API/loopback-provider cases cover selection, revocation, ownership, usage and secret projection. Secret-manager selection, live smoke, hot rotation and aggregate monitoring UI remain open. [Contract and rollout](development/CONNECTION-CREDENTIALS.md).

## Unreleased — 21 October 2026 — attached teardown observation races

Fixed native host list/state and signal-delivery races exposed by conformance: attached teardown may remove state or finish the target before the next CLI operation. A fresh successful observation through a healthy transport now distinguishes that outcome without poisoning an otherwise provably clean owner or resending a signal. Still-live/foreign targets, failed observations and poisoned transports remain fail closed; original monitor/delete/kernel/final-absence requirements are unchanged. Deterministic positive/negative regression tests cover both CLI boundaries. [Semantics](development/NATIVE-RUNSC-HOST.md#closing-safely).

## Unreleased — 20 October 2026 — native worker with real PostgreSQL/Redis coordinators

Added an explicit disposable Linux gate combining two real API processes, shared PostgreSQL/Redis and the real native worker/sandbox. Cases cover lost claim ACK plus API-peer handoff without a second run, cross-API cancellation/late unknown evidence, and missing Redis lease followed by durable orphan fencing and denied fresh-boot replacement. Clean shutdown independently checks monitor reaping, kernel subtree emptiness, runtime absence and ownership release without settlement. CI runs this gate alongside existing quality and gVisor checks; the quality host is pinned to the approved Ubuntu 24.04 fixture baseline. No production activation, API, migration, reassignment policy or ADR change. [Scope](development/NATIVE-COORDINATOR-CONFORMANCE.md).

## Unreleased — 20 October 2026 — worker-owned native sandbox lifetime

Added explicit native worker composition with a matching host/driver and bounded monitor capacity. Worker stop/drain remains bounded assignment evidence; `close()` separately awaits host ownership proof, also on fatal/shutdown stops. Unknown stop or unavailable durable stop receipt explicitly retains the lock; a host error cannot upgrade a receipt or retry close into success. Behavioral tests cover lifecycle ordering and final dispatch denial across expiry/fence/quiesce during preparation. Five real gVisor worker cases add signal/renewal/cancel/preparation-expiry/LOST evidence with controlled coordinator replies. Coordinator-backed native-worker chaos, trusted runtime/delivery and production gates remain open. No API, migration or ADR change. [Scope](development/NATIVE-RUNNER-WORKER.md).

## Unreleased — 20 October 2026 — native runsc host ownership lifecycle

Added a layout-bound Linux host factory and trusted lifecycle composition across verified bundles, durable reservations, bounded runsc monitors and native cgroups. Concurrent reservations grant one launch; shutdown seals starts before draining accepted preparation and original monitors. Clean close requires durable binding checks, trusted delete, whole-subtree emptiness, fresh runtime absence and closed component descriptors before unlock. LOST/foreign/live/partial/error cases retain the lock through explicit retained store close; no automatic takeover or retirement is added. Behavioral tests and three disposable real gVisor cases cover clean/pending/LOST close. Full worker fencing, production runtime/delivery/host recovery and O03 remain open. No API, migration or ADR change. [Scope](development/NATIVE-RUNSC-HOST.md).

## Unreleased — 20 October 2026 — native cgroup evidence and live owner crash

Added bounded read-only cgroup2 inspection using kernel hierarchical population evidence, FD/root/filesystem checks and strict interface parsing. Real gVisor driver conformance now uses it, with separate empty-parent/populated-child and SIGKILL-owner/live-orphan cases. Stale storage locks refuse reopen before and after explicit exact-bound runtime/subtree/monitor cleanup; no lock takeover, retry or production host activation is added. Native whole-host ownership/close composition, worker fencing, trusted release/credentials, Claude/egress and actual VPS remain dependencies. [Scope](development/NATIVE-CGROUP-OWNER-CRASH.md).

## Unreleased — 20 October 2026 — native runsc process transport

Added a Linux process client with a pinned entrypoint, held root checks, fixed systrap/no-network commands, isolated environment, bounded command/monitor admission and output, explicit deadlines and retained attached monitors. Real driver conformance now uses it and injects monitor loss without rerun/new work or inferred termination. Numeric monitor status remains local evidence; sidecar provenance, exclusive whole-host ownership/recovery, live-orphan crash, Claude/credentials/egress and actual VPS gates remain open. No API, migration or ADR change. [Scope](development/NATIVE-RUNSC-PROCESSES.md).

## Unreleased — 20 October 2026 — pinned rootfs bundle production

Added strict canonical rootfs manifests, trusted content pins and an async Linux OCI bundle producer/verifier. It checks the complete regular-file tree, copies to independent readonly inodes, emits a fixed least-privilege config and binds full assignment/rootfs digest to persisted config digest. Existing/partial bundles never authorize fresh preparation after reopen. Real gVisor fixtures now use this producer, independently pin BusyBox bytes and deny same-size rootfs tampering before reservation/dispatch. Content pins are not production provenance/image approval; native host/recovery, Claude/credential/egress and actual VPS gates remain open. No API, migration or ADR change. [Scope](development/VERIFIED-RUNSC-BUNDLES.md).

## Unreleased — 19 October 2026 — persistent runsc launch reservations

Added async private Linux reservation storage with strict assignment/bundle/config-digest metadata, exclusive session lock, no-clobber fsync commit, bounded intake and fail-closed corruption handling. Stale locks deny takeover; recovered stores only read/replay and block fresh work. Linux tests cover pre-spawn SIGKILL/no-rerun and filesystem conflicts; real gVisor conformance replaces ad hoc markers and checks clean reopen after owned-tree cleanup. Declared digests are not image verification; native live-orphan recovery, power/volume/node-loss proof, actual VPS, Claude/credentials/egress, retention and O03 approval remain open. No API, migration or ADR change. [Scope](development/RUNSC-LAUNCH-STORE.md).

## Unreleased — 19 October 2026 — gVisor driver/supervisor lifecycle

Added `RunscSandboxDriver` over an explicit trusted host port, with deterministic assignment naming, full binding, reservation-before-spawn/no-rerun semantics and independent delete/cgroup-subtree/absence inspection. Supervisor propagates an authority/stop/drain guard through asynchronous preparation to synchronous spawn, retaining pending creation for cleanup. Linux conformance builds the runner and tests the real driver/supervisor against pinned runsc for recovery, graceful/forced child stop and fast exit. The only host remains a disposable inert fixture with fsynced markers; production host/image verification, crash proof, Claude/credentials/broker, retirement and O03 approval remain open. No migration, API or ADR change. [Scope](development/RUNSC-DRIVER.md).

## Unreleased — 19 October 2026 — real gVisor Linux fixture gate

Added a separate `gvisor-conformance` quality workflow job and explicit disposable-host CLI probe for the selected Linux VM/VPS deployment direction. CI verifies the checksum of pinned gVisor release-20261012.0 including required sidecars, then exercises inert static BusyBox fixtures through the real systrap/no-network runtime with read-only rootfs, least privilege and cgroup/tmpfs caps. Cases cover ordinary exit, duplicate create/start, exact annotation observations, basic containment, graceful stop and TERM-ignoring child forced termination with cgroup-empty/delete checks. Unit policy/host/foreign-binding tests run cross-platform; unsupported local hosts refuse without sandbox mutation. No worker driver/production image/Claude/broker activation, ADR change, reassignment or O03 closure is implied. Actual VPS and broader hostile/crash/compatibility gates remain pending.

## Unreleased — 19 October 2026 — application tool-operation status reads

Added application-scoped backend GET routes to list an execution's durable tool operations and read one operation, under `execution:read`. Bounded UUID keyset pagination exposes all five persisted states and receipt pairs while omitting assignment/lease/receiver-key details and input bytes. Missing and inaccessible resources return the same 404; runner/operator principals are denied. Reads remain available after fencing and receiver-retention expiry without invoking a receiver, resolving UNKNOWN, finalizing execution or changing accounting. Contract/auth tests and real PostgreSQL/two-API integration cover isolation, pagination, all states and unchanged storage/receiver-call counts. Invocation authorization/runner integration, live receiver conformance and sandbox/runtime remain pending; no migration or ADR change.

Serialized integration test files that share a PostgreSQL schema, preventing API reapers with private in-memory lease stores from fencing another file's deliberately expired fixture. Concurrency scenarios inside individual tests and the separate shared-Redis worker HTTP gate remain concurrent.

## Unreleased — 19 October 2026 — coordinator stop receipts and result matching

Added machine-only quarantined stop intake and read-only canonical proposal-digest reconciliation, plus an explicit runner HTTP client without retries or journal retirement. Additive migration 0026 records original claim registration revision for new assignments and stores scoped immutable stop receipts; legacy process revision is never inferred. Exact original token/boot/revision/owner is required without live lease/presence or current registry eligibility. Receipt/audit/outbox commit atomically; duplicate evidence replays and conflicting content is rejected. Receipt/match does not change execution/attempt authority, compute, budgets, verified usage, ledger or final results. PostgreSQL, HTTP authorization, client and multi-coordinator tests cover rollback, fencing, old registry identity, lost ACK and no duplicate proposal. Independent stop verification, retirement, production credentials/KMS/storage and real sandbox/runtime remain open; no ADR change.

## Unreleased — 19 October 2026 — immutable runner outcome and local stop journal

Added an optional encrypted `RunnerOutcomeJournal`, reserving two bounded record slots per assignment before launch. Valid result candidates are captured before proposal HTTP and retained after ambiguous ACK or late runtime return. Lifecycle abort/runtime cleanup/worker stop share one local stop record, including lease loss while runtime remains pending. Local termination evidence stays separate from `durableReceipt: RECORDED|UNAVAILABLE`; failed writes deny new work/claim without inventing termination, completion or settlement. Cipher deadlines erase late responses without late append; recovery retains immutable unknown evidence and blocks new boots pending reconciliation. Linux crash tests cover candidate-only/post-stop windows; the PostgreSQL lost-result-ACK gate reopens the journal without duplicate proposal/runtime. Coordinator receipt intake/reconciliation/retirement, production cipher/KMS/host lifecycle/I/O isolation, retention and real sandbox/runtime remain pending; no API/schema/migration/ADR changes.

## Unreleased — 19 October 2026 — bounded durable runner evidence collection

Added an optional trusted `RunnerEvidenceCollector` and Linux encrypted file spool. Accepted usage is persisted before HTTP and removed only after valid quarantine receipt; explicit replay preserves old assignment/event identity and unknown cost. Backlog, pending intake and storage/key failures block new paid work across worker assignments. Storage has exclusive ownership, private bounded files and file/directory fsync, without TTL eviction or automatic crash-lock takeover. Tests cover ACK/storage failures, conflicts, caller mutation, Linux SIGKILL recovery and committed-ACK loss/reopen through real API B with PostgreSQL dedup. Cipher/key delivery is injected with no production default; synchronous file I/O isolation, persistent storage/power-loss/node-loss proof, retention, production credentials/KMS, result-candidate persistence and stop receipts remain pending. No API/migration/ADR or sandbox decision changes.

## Unreleased — 19 October 2026 — worker HTTP multi-coordinator integration gate

Added `test:runner:http` to quality CI, connecting the worker through a fault-injecting loopback proxy to two independent full API processes sharing PostgreSQL/Redis. Scenarios exercise lost claim/result acknowledgements, API A exit with continuation on B under the same assignment/boot/nonce, cross-API durable cancel, missing lease no-recreate and API reaper fencing, held reservation and late evidence dedup without ledger verification, and no automatic replacement. The harness requires disposable-service opt-in, scoped cleanup and bounded child-process teardown. Runtime/sandbox and local authentication remain fixtures; no payload/KMS/plugin production route, strict nonlocal epoch, real Redis failover, live Claude, completion/settlement or durable reporting spool is introduced. Production source and adopted ADRs are unchanged.

## Unreleased — 19 October 2026 — runner authority preflight and outcome/evidence reporting

Worker provider/tool steps now use the existing activation/renew endpoint to recheck durable cancel/fence policy before dispatch, then recheck local authority after the await. Periodic renewal also stops in-flight work on durable rejection. Typed runtime returns submit one exact lease-scoped result proposal; runtime return seals retained dispatch/input contexts and outstanding unawaited work prevents proposal. A separate HTTP 202 quarantine evidence client remains usable after stop/fence, preserves event identity and unknown cost, and bounds concurrent intake without automatic retry. Pending/failed evidence blocks further paid work. TDD and loopback fixtures cover cancel, late evidence, ambiguous reports and runtime-return races. PostgreSQL tests prove both cancel/proposal commit orders, evidence dedup after fencing, and absence of ledger/usage-observation writes from intake. Completion, settlement, durable reporting spool, fast signals, real sandbox/Claude execution and stop-receipt reconciliation remain pending; no ADR or active API schema changes.

## Unreleased — 19 October 2026 — scoped worker payload/plugin handoff

Added lease-bound binary delivery client and a one-use `RunnerStepContext.withInputs` handoff after exact STARTED acknowledgement. Payload size must match the grant; plugin bytes pass pinned digest/runtime/permission/file validation. Binary transport rejects redirect, compression, caching, missing or mismatched length, oversized and stalled bodies; credentials, request and body share one deadline with caller abort and no retry. Partial chunks and borrowed input buffers are erased on failure/abort or callback settlement. Loopback worker proof reaches private-root materialization of inert fixture files; coordinator, sandbox and runtime remain fixtures. Production routes/KMS/signer trust, real sandbox/Claude execution, durable cancel/result/evidence and stop-receipt reconciliation remain pending. Approved ADRs and production activation are unchanged.

## Unreleased — 18 October 2026 — programmatic runner worker bootstrap

Added `RunnerWorker` with one process boot UUID, independent heartbeat and serialized pull polling, a retained lifecycle/nonce per assignment, local capacity, and exact STARTED acknowledgement before trusted runtime dispatch. Process presence is rechecked at driver launch and each new step. Host shutdown signals use non-extensible bounded drain before local cleanup; unconfirmed stops retain capacity and assignment tombstones are bounded without automatic eviction. Shared machine HTTP transport preserves byte/deadline/origin limits, sanitizes errors, and supports caller abort. Loopback HTTP and fault fixtures cover lost acknowledgements, duplicate/mutated grants, presence-expiry races, timer failure, and shutdown. Deployment credentials/registration, real sandbox/Claude execution, payload/plugin and durable cancel/result/evidence delivery remain pending.

## Unreleased — 16 October 2026 — single-assignment runner lifecycle

Composed lease activation, monotonic step gating, renewal/watchdog scheduling, and local sandbox supervision in `RunnerAssignmentLifecycle`. Concurrent starts on one instance share activation and launch; cancellation, failed renewal, expiry, and bounded launch failure close the gate before cleanup. Late responses cannot reopen a stopped instance, and in-flight operation results remain available for durable reconciliation. The dedicated lifecycle harness includes a loopback HTTP server and fixture sandbox/runtime. Production worker bootstrap, credentials, payload/plugin delivery, sandbox/Claude execution, and durable stop-receipt reconciliation remain pending.

## Unreleased — 29 September 2026 — initial runner pull dispatch

Added the machine-only `/api/runner/v1/dispatches/claim` route and enabled runner protocol execution dispatch for initial `agent_execute` placement. Claims require authenticated ownership, exact registration revision, and exact current boot presence. PostgreSQL remains authority and atomically checks current application/connection/binding policy, pool/node lifecycle, environment, minimum version, capability, advertised connection, runner-local or central credential, capacity, and committed envelope before issuing generation 1 assignment authority. Duplicate/concurrent claims replay one scoped grant containing only assignment and sanitized envelope metadata; object keys, wrapped/plaintext keys, payloads, and credentials remain withheld. ADR-0031 records the decision. Payload/KMS delivery, lease-driven recovery, automatic reassignment, sandbox/tools, and agent execution remain pending.

## Unreleased — 27 September 2026 — P0 observability baseline

Added manual, bounded OpenTelemetry tracing with W3C TraceContext propagation from BFF to API and onward to provider requests. API and BFF ingress/client spans are bounded at response-header boundaries; hijacked SSE ends its ingress span at `flushHeaders`, so streams do not create zombie spans. Gateway admission and provider invocations use explicit phase spans, with provider attempts linked back to admission using Trace Links. Fitness tests forbid OpenTelemetry imports in application/domain layers, per-token/delta span events, baggage, prompt/raw-output/credential attributes, and metrics emission before a low-cardinality metric contract exists. Optional OTLP HTTP export is enabled only through the validated `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`; local/test mode propagates trace context with no exporter/network dependency.

## Unreleased — 27 September 2026 — P0 configuration isolation

Split the configuration boundary into explicit least-privilege projections: `loadApiEnvironment()`, `loadWebEnvironment()`, `loadDevEnvironment()`, `loadE2EEnvironment()`, and `loadDatabaseEnvironment()`. API startup no longer validates or depends on `PLAYWRIGHT_*`; Prisma/migration tooling no longer requires application/web/test configuration; development and E2E own their separate settings. Removed the monolithic `loadEnvironment()` entry point and added a fitness test that rejects its reintroduction in apps/scripts. Local root `.env` remains a developer convenience, not a requirement that production processes receive all variables. Full `npm run verify` and browser E2E 21/21 pass after the change. P0 production composition also moves global `/health/live` into `CoreHealthModule` and adds `DEPLOYMENT_ROLE=api-production`, which omits `ContractLabModule` so `/api/m0/*` is not registered; nonlocal API startup requires an explicit deployment role.

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
