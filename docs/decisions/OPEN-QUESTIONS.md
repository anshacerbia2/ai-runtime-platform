# Open Decisions dan Residual Risk Register

**Baseline 0.2.** [ADR](../adr/README.md) mencatat keputusan aktif; pilihan deployment dan bukti berikut belum ditetapkan. Tidak diisi dengan angka/asumsi seolah disetujui. Status semua OPEN sampai owner memberi keputusan/evidence; peran disebut, individu belum ditetapkan.

| ID | Keputusan yang diperlukan | Candidate / boundary | Owner role | Deadline gate |
| --- | --- | --- | --- | --- |
| O01 | Implementation language, versions, API schema tooling | TypeScript candidate untuk reuse; pinned supported versions | Engineering | P0 |
| O02 | Hosting, region, AZ, backups, RPO/RTO, on-call | No cloud or region implicitly selected | Platform operations | P3.5 |
| O03 | Sandbox tech, Redis topology/epoch detection, external queue | Hardened containers/gVisor/microVM reviewed; PG work authority | Security + runtime | P3 |
| O04 | SLO windows/numbers, cap values, failure timing delta | ADR parameter candidates only; per-workload budgets | Operations + app owners | P3.5 |
| O05 | Provider/runtime credential agreements and API scopes | No unverified consumer-account pooling | Security + service owner | Before live provider use |
| O06 | Data classification, ZDR/region, payload/audit retention, deletion/hold | Profile policy; no universal permanent retention | Data/security owner | Before sensitive data use |
| O07 | Price-source/version, rounding, currency/period semantics, overage/manual-release policy | Durable holds + append-only adjustments | Accounting owner | P1 design closure |
| O08 | Pilot selection, golden fixtures, acceptance thresholds, cutover/rollback | Scribe + simple chat/inference target patterns | App owners | P4 |
| O09 | Stateful tools eligible, receiver retention/status guarantees, approval channel | Artifact-only Scribe default; unsupported mutation denied | App + security | P3 |
| O10 | Future embedding/rerank/audio capability and model-index migration | Demand-driven; separate app migration | App + platform | P7; not MVP blocker |
| O11 | Review of operational baseline decisions recorded in ADRs | M01–M10 mapped in [decision traceability](../reviews/RECONCILIATION.md); explicit reviewer disposition required, not automatic approval | Architecture reviewers | P0 |
| O12 | Replay byte/event caps, idempotency retention/tombstones, session lifetime | Must be bounded and published; no unlimited defaults | Platform + app owners | P0/P3.5 |
| O13 | Per-runtime usage granularity/enforcement and residual in-flight exposure | Reject profiles promising unavailable controls | Runtime + accounting | P3/P5/P6 |

## Residual risks requiring evidence

Redis/postgreSQL checks do not form a cross-store transaction; authority cutover is durable CAS and external effects need receiver protection. Opaque runtimes may only report summary usage and not support per-invocation budget interposition. Provider network cancellation may not stop already accepted charges. Direct provider failover may share underlying vendor/region failure modes. Sandboxing is platform/configuration-dependent. Price updates and late provider corrections can cause estimate differences.

These risks are not hidden by changing status names. Each receives a tested mitigation, limited scope, or explicit risk acceptance by the responsible owner before production.

## Decision closure

Record chosen option, alternatives, affected ADR/contracts/profiles, reviewer/date, implementation/test evidence, and reversal trigger. Closing architecture discussion is not equivalent to closing implementation verification. Repointing documentation to ADR does not close O11 or imply approval of an unreviewed revision.
