# AI Runtime Platform — Roadmap

Native host lifecycle now composes the existing Linux components under one fixed private layout. Pending creation holds ownership; only reaped monitors plus durable binding/delete/cgroup/fresh-absence proof permit clean unlock. LOST or uncertain cleanup retains the lock. Next is full worker lease/cancel/drain binding and real sandbox races, followed by the trusted runtime/delivery bridge. This advances the prior checkpoints below without production activation, takeover/retirement, O03 closure or an ADR change. [Scope](development/NATIVE-RUNSC-HOST.md).

**Baseline 0.2 + extensions through ADR-0031; status source diperiksa 30 September 2026.** Roadmap berbasis dependency dan gate, bukan janji tanggal. M0 tetap runnable; M1 local P1 foundation sekarang implemented dan lulus acceptance lokal, sementara live Keycloak sign-in, deployed BFF/Redis session evidence, production KMS, provider runtime, dan production readiness belum selesai. Lihat [M0](milestones/M0.md) dan [M1](milestones/M1.md).

## Stack implementasi tetap

NestJS + Fastify + Prisma + PostgreSQL, React/Next.js App Router + BFF, TypeScript strict, Prettier, ESLint, dan dependency rules. M0 sudah direfactor; M1 dan berikutnya memakai boundary yang sama. Lihat [ADR-0016](adr/0016-nestjs-fastify.md), [ADR-0017](adr/0017-prisma-postgresql.md), [ADR-0018](adr/0018-clean-architecture-quality.md), [ADR-0026](adr/0026-nextjs-bff.md), dan [code structure](architecture/CODE-STRUCTURE.md). Perubahan stack bukan penutupan production readiness gate.

## Sudah tersedia sebelum milestone runtime

Native cgroup2 inspection and a real live-owner SIGKILL gate now extend sandbox evidence. Kernel hierarchical population detects nested tasks even with an empty parent PID list. Stale-lock reopen is denied before and after explicit orphan cleanup, without rerun or invented monitor status. Native whole-host ownership/close composition, operational recovery, worker fencing and production runtime dependencies remain open. [Scope](development/NATIVE-CGROUP-OWNER-CRASH.md).

Native runsc process transport now supplies fixed commands, pinned entrypoint checks, bounded output/admission/deadlines and attached monitors to real driver conformance. A lost monitor cannot become termination evidence or authorize rerun; whole-host ownership/live-orphan recovery, trusted release/credential composition, Claude/egress and actual VPS remain M3 dependencies. [Scope](development/NATIVE-RUNSC-PROCESSES.md).

Pinned file-tree verification and readonly OCI bundle production now feed real gVisor conformance, including tamper denial before reservation/dispatch. This advances M3 content integrity; production image provenance/approval, native host recovery, Claude/credential/egress and actual VPS remain dependencies. [Scope](development/VERIFIED-RUNSC-BUNDLES.md).

Private Linux launch storage now persists immutable binding/config-digest metadata before spawn, with exclusive ownership, bounded async I/O and fail-closed lock/reopen semantics. Pre-spawn SIGKILL and real runsc storage-reopen conformance advance M3; verified images, native live-orphan host recovery, Claude/egress and actual VPS remain dependencies. [Scope](development/RUNSC-LAUNCH-STORE.md).

Linux VM/VPS is the owner-stated runner deployment direction. A pinned gVisor `systrap` disposable Linux fixture probe and separate CI job exercise real runtime lifecycle/basic containment/resource caps. [Driver/supervisor lifecycle](development/RUNSC-DRIVER.md) now composes with real runsc through a disposable host fixture. Production host/storage/image verification, full worker lease integration, Claude compatibility, broker egress, actual VPS and hard-crash evidence remain open; O03 is still experimental. [Scope](security/SANDBOX-EVALUATION.md#linux-vmvps-experiment).

Application backend tool-operation list/status reads are implemented with scoped authorization, bounded UUID pagination and durable uncertainty/receipt semantics after fencing. Reads do not invoke receivers or change execution/accounting. Authorized invocation, runner integration, receiver conformance and real sandbox/runtime remain M3 work. [Scope](development/M3.md#application-tool-operation-status).

Coordinator outcome intake now adds immutable quarantined stop receipts and read-only canonical result matching under the original process binding. An explicit runner client supports lost-ACK reconciliation without new result proposals or deleting journals. This advances coordinator receipt intake below; independent stop/effect verification, authorized retirement/reassignment and production runtime/identity/storage remain open. [Scope](development/M3.md#coordinator-stop-receipt-dan-result-reconciliation).

The outcome-journal checkpoint adds encrypted result candidates and immutable local stop evidence, including late results, bounded key-provider waits and two reserved slots before launch. Linux tests cover candidate-only/post-stop SIGKILL and journal reopen after a committed result ACK is lost. Recovery remains fail closed; coordinator receipt/reconciliation/retirement and production host/KMS/storage/retention remain dependencies. This advances the result-candidate dependency below without closing sandbox/runtime gates or changing ADRs. [Scope](development/M3.md#durable-result-candidate-dan-local-stop-journal).

Checkpoint evidence collector 19 October 2026 adds optional durable encrypted write-before-send and explicit quarantine replay, with Linux file-spool process-crash tests and real API/PostgreSQL lost-ACK dedup proof. Backlog blocks further spend. This advances the reporting durability dependency below; production KMS/collector host lifecycle, I/O isolation, persistent-volume/node-loss recovery, retention, result-candidate durability and stop receipts remain open alongside sandbox/runtime delivery. No production activation or ADR change. [Scope](development/M3.md#bounded-evidence-collector-dan-encrypted-file-spool).

Local M1 sekarang mencakup resource-oriented reads/mutations, receipt/retry, explicit serialization mapping, dan runner assignment/fencing/quarantine kernel. Ini merupakan fondasi untuk M3, bukan M3 agent execution yang sudah selesai. [Kondisi aktual](implementation/CURRENT-STATE.md) memuat scope tepat; [request closure](reviews/REQUEST-CLOSURE.md) memuat keputusan kontrak yang sudah diimplementasikan.

## North star

Satu AI Runtime Platform dengan canonical capability catalogue (`chat`, `generate`, `structured_generate`, `agent_execute` pada baseline v1) sementara app tetap memiliki workflow. Control Plane mengelola applications, profiles, AI connections/credential bindings, plugin registry, runner fleet, policy, budget, audit, dan Admin UI; Execution Plane menjalankan gateway/runtime/workers. Setiap execution dapat ditelusuri tanpa menganggap semua runtime, plugin, account, atau runner interchangeable.

## Milestones

| Milestone                        | Outcome                                                                  | Dependency               | Exit evidence                                     | Status                                                                                                                                                 |
| -------------------------------- | ------------------------------------------------------------------------ | ------------------------ | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| M0 — Contract baseline           | API, state, usage, stream, profile, tool schemas disepakati              | Review docs              | P0 review + blocking decisions resolved           | IN PROGRESS; contract lab runnable, formal review pending                                                                                              |
| M1 — Durable foundation          | App/connection/credential/runner registries, identity, ledger, execution | M0                       | Admission, cross-app isolation, persistence tests | LOCAL COMPLETE; external deployment evidence pending                                                                                                   |
| M2 — Direct & Aggregator Gateway | OpenRouter-first + Direct Anthropic proof; chat/structured/stream        | M1                       | Adapter conformance and restricted routing tests  | LOCAL IMPLEMENTATION COMPLETE; live vendor smoke pending                                                                                               |
| M3 — Claude Agent Runtime        | Distributed runner placement, plugin/workspace, tools, artifacts         | M1 + shared M2 contracts | Fleet, agent, cancellation, orphan, tool tests    | IN PROGRESS; pull placement, lease/recovery, epoch barrier, internal tool-effect/HTTP adapter, plugin registry/pinning/materializer/signature/delivery |
| M3.5 — Production Readiness Gate | Measured reliability/security/accounting confidence                      | M1–M3                    | Applicable gate report and rollback drill         | BLOCKED; not yet implemented                                                                                                                           |
| M4 — Application migration       | Scribe/simple inference/Farexlate/RAG adopt without losing job ownership | M3.5                     | Per-app quality, canary, audit, rollback sign-off | PLANNED                                                                                                                                                |
| M5 — Codex runtime               | Tested second agent implementation                                       | M3.5 + workload          | Runtime conformance + plugin acceptance           | PLANNED                                                                                                                                                |
| M6 — Gemini runtime              | Tested third agent implementation                                        | M3.5 + workload          | Runtime conformance + plugin acceptance           | PLANNED                                                                                                                                                |
| M7 — Expansion                   | Additional capabilities/providers/scale justified by usage               | Demand and ADR           | Capability-specific gates                         | FUTURE                                                                                                                                                 |

## Decisions retained

M3 checkpoint 19 October 2026: programmatic worker bootstrap and scoped binary payload/plugin handoff are implemented locally. A loopback fixture reaches pinned-package materialization and bounded drain; it does not activate production endpoints or prove real sandbox/Claude execution. Next dependencies remain trusted production KMS/signer/storage composition, approved sandbox adapter and runtime bridge, durable cancel/result/evidence delivery, and stop-receipt reconciliation. [Implementation scope](implementation/CURRENT-STATE.md) and [local recipe](development/M3.md) distinguish this checkpoint from the remaining M3 gate.

The subsequent local authority/reporting slice adds durable preflight through existing lease renewal, one typed result proposal, and late quarantine evidence intake. Fixture HTTP worker and separate PostgreSQL proofs preserve cancel/fence ordering and keep completion/settlement separate. Durable reporting collection/spool, fast cancel signals, stop receipts/retirement, approved sandbox/Claude execution and production delivery remain dependencies; applicable M3/M3.5 gates stay open.

The worker HTTP CI gate now composes two real API processes with shared PostgreSQL/Redis to test coordinator A→B continuation, lost acknowledgements, cross-API cancel, missing-lease fencing, held budget and quarantined late evidence. Local fixture auth and inert runtime/sandbox limit this evidence; strict nonlocal epoch/failover, production runtime and reporting durability remain separate dependencies.

Keputusan aktif dirujuk melalui [ADR](adr/README.md). OpenRouter may remain primary per profile. A direct adapter proof does not automatically enable failover. Codex is an agent-runtime target, not another label for an inference API. Redis handles hot streams/heartbeat; authoritative reservations and settlement use durable transactions. Completion and accounting stay independent.

## Readiness is not inferred

ADR records the adopted design; the [decision traceability register](reviews/RECONCILIATION.md) maps decisions to operational specifications and gates. There are no passed implementation gates, deployment metrics, finalized production SLOs, or approved retention policies merely because the documentation exists. Pending ADR review remains tracked separately.

## Success measures

| Area             | Measure to establish before cutover                                                                         |
| ---------------- | ----------------------------------------------------------------------------------------------------------- |
| Product boundary | Direct chat needs no fake job; Scribe retains business state and publication                                |
| Portability      | Same API conformance suite passes both gateway adapters and each enabled runtime                            |
| Safety           | No stale write after durable fence; no duplicate mutation from retry tests                                  |
| Accounting       | Holds survive crash, denial leaves budget unchanged, duplicates do not double-charge; unknown ratio visible |
| Experience       | App-defined quality and latency plus total cost per accepted business output                                |
| Recovery         | Detection, termination, external reconciliation, and financial settlement timed separately                  |
| Operations       | Tested rollback, restore, credential rotation, retention/deletion                                           |
| App isolation    | Dedicated/shared connection bindings and plugin/profile ownership deny cross-app use                        |
| Fleet placement  | Runner locality/capability/drain/failover behavior proven without multiplying shared upstream quota         |

Numbers must name test environment, baseline, measurement window, and owner. Candidate heartbeat 5s/TTL 15s/reaper 5s follows [ADR-0005](adr/0005-leases-fencing.md) and the [parameter register](operations/SLO-CAPACITY.md); detection timing includes scheduling/network delay, not a universal deterministic guarantee.

## Release sequence

Nonproduction examples -> applicable conformance tests -> gate -> limited production canary -> app owner acceptance -> wider rollout. Provider/runtime upgrade repeats affected tests. New capabilities do not inherit blanket production approval from old ones.

Detailed work packages: [PLAN](PLAN.md). Test catalogue: [ACCEPTANCE](testing/ACCEPTANCE.md). Open deployment/product choices: [OPEN-QUESTIONS](decisions/OPEN-QUESTIONS.md). Visual dependency flow: [evolution diagrams](diagrams/08-evolution-migration.md).

## Control-plane, web delivery, dan frontend capability progression

- **M1:** Application Registry foundation, dedicated Keycloak client dengan Authorization Code sign-in pada external-app delivery, Next.js/BFF web tier, AI Connections, credential bindings/instances, runner registry/pools, Admin UI foundation; frontend CDD/token dan Next.js/BFF sudah diimplementasikan lokal, termasuk paginated resource views dan explicit mutation outcomes.
- **M2:** connection-aware gateway routing; dedicated/shared connection and quota-group enforcement; production-facing shared components continue through isolated accessibility/visual-regression gates.
- **M3:** initial pull placement memfilter process presence, policy, capability, capacity, connection, dan runner-local credential. Internal scoped payload read, tool-effect recovery/HTTP adapter, registry/pinning/materializer plugin, Ed25519 verifier, bounded S3 reader, dan lease-scoped plugin delivery tersedia tanpa runtime execution. Berikutnya: aktivasi authenticated payload/plugin HTTP routes dan production KMS/signer trust wiring, lease-driven reassignment/recovery, sandbox execution, optional workspaces, serta authorized remote tools.
- **M3.5:** isolation, supply-chain, shared-quota, drain/failover/fencing evidence.
- **M4+:** onboard apps without embedding provider credentials, plugin paths, or runner addresses in application contracts.
