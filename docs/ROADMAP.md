# AI Runtime Platform — Roadmap

**Baseline 0.2 · 20 September 2026.** Roadmap berbasis dependency dan gate, bukan janji tanggal. M0 sudah mempunyai frontend, API validasi dan persistence PostgreSQL lokal; runtime AI, gateway, dan ledger produksi belum diimplementasikan. Lihat [M0](milestones/M0.md).

## North star

Satu kontrak AI execution yang melayani direct chat, structured calls, dan agent/plugins; app tetap memiliki workflow. Setiap execution dapat ditelusuri penggunaannya tanpa menganggap semua runtime interchangeable.

## Milestones

| Milestone | Outcome | Dependency | Exit evidence | Status |
| --- | --- | --- | --- | --- |
| M0 — Contract baseline | API, state, usage, stream, profile, tool schemas disepakati | Review docs | P0 review + blocking decisions resolved | IN PROGRESS; contract lab runnable, formal review pending |
| M1 — Durable foundation | Identity, idempotency, reservation/ledger, execution/outbox | M0 | Admission/crash/isolation tests | PLANNED |
| M2 — Direct & Aggregator Gateway | OpenRouter-first + Direct Anthropic proof; chat/structured/stream | M1 | Adapter conformance and restricted routing tests | PLANNED |
| M3 — Claude Agent Runtime | Isolated managed execution, lease/fencing, tools, artifacts | M1 + shared M2 contracts | Agent, cancellation, orphan, tool safety tests | PLANNED |
| M3.5 — Production Readiness Gate | Measured reliability/security/accounting confidence | M1–M3 | Applicable gate report and rollback drill | BLOCKED; not yet implemented |
| M4 — Application migration | Scribe/simple inference/Farexlate/RAG adopt without losing job ownership | M3.5 | Per-app quality, canary, audit, rollback sign-off | PLANNED |
| M5 — Codex runtime | Tested second agent implementation | M3.5 + workload | Runtime conformance + plugin acceptance | PLANNED |
| M6 — Gemini runtime | Tested third agent implementation | M3.5 + workload | Runtime conformance + plugin acceptance | PLANNED |
| M7 — Expansion | Additional capabilities/providers/scale justified by usage | Demand and ADR | Capability-specific gates | FUTURE |

## Decisions retained

Keputusan aktif dirujuk melalui [ADR](adr/README.md). OpenRouter may remain primary per profile. A direct adapter proof does not automatically enable failover. Codex is an agent-runtime target, not another label for an inference API. Redis handles hot streams/heartbeat; authoritative reservations and settlement use durable transactions. Completion and accounting stay independent.

## Readiness is not inferred

ADR records the adopted design; the [decision traceability register](reviews/RECONCILIATION.md) maps decisions to operational specifications and gates. There are no passed implementation gates, deployment metrics, finalized production SLOs, or approved retention policies merely because the documentation exists. Pending ADR review remains tracked separately.

## Success measures

| Area | Measure to establish before cutover |
| --- | --- |
| Product boundary | Direct chat needs no fake job; Scribe retains business state and publication |
| Portability | Same API conformance suite passes both gateway adapters and each enabled runtime |
| Safety | No stale write after durable fence; no duplicate mutation from retry tests |
| Accounting | Holds survive crash, denial leaves budget unchanged, duplicates do not double-charge; unknown ratio visible |
| Experience | App-defined quality and latency plus total cost per accepted business output |
| Recovery | Detection, termination, external reconciliation, and financial settlement timed separately |
| Operations | Tested rollback, restore, credential rotation, retention/deletion |

Numbers must name test environment, baseline, measurement window, and owner. Candidate heartbeat 5s/TTL 15s/reaper 5s follows [ADR-0005](adr/0005-leases-fencing.md) and the [parameter register](operations/SLO-CAPACITY.md); detection timing includes scheduling/network delay, not a universal deterministic guarantee.

## Release sequence

Nonproduction examples -> applicable conformance tests -> gate -> limited production canary -> app owner acceptance -> wider rollout. Provider/runtime upgrade repeats affected tests. New capabilities do not inherit blanket production approval from old ones.

Detailed work packages: [PLAN](PLAN.md). Test catalogue: [ACCEPTANCE](testing/ACCEPTANCE.md). Open deployment/product choices: [OPEN-QUESTIONS](decisions/OPEN-QUESTIONS.md). Visual dependency flow: [evolution diagrams](diagrams/08-evolution-migration.md).
