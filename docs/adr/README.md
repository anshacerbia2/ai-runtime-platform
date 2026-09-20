# Architecture Decision Records

**Baseline 0.2 · 20 September 2026.** ADR adalah rujukan keputusan arsitektur yang aktif: konteks, keputusan, alternatif, konsekuensi, verification, dan revisit trigger. Status adopted in documentation tidak berarti implemented/tested. Review baseline tetap dilacak melalui O11 pada [OPEN-QUESTIONS](../decisions/OPEN-QUESTIONS.md).

## Decision catalogue

| ADR | Decision | Spesifikasi terkait |
| --- | --- | --- |
| [ADR-0001](0001-application-ownership.md) | Application-owned workflow dan AI execution boundary | [BOUNDARIES](../architecture/BOUNDARIES.md) |
| [ADR-0002](0002-managed-envelope.md) | Managed Execution Envelope dan typed profiles | [PROFILES-ADAPTERS](../contracts/PROFILES-ADAPTERS.md) |
| [ADR-0003](0003-tiered-storage.md) | Tiered Storage dan authoritative data paths | [DATA-MODEL](../data/DATA-MODEL.md) |
| [ADR-0004](0004-routing-dual-adapter.md) | OpenRouter-first dan dual-adapter proof | [PROFILES-ADAPTERS](../contracts/PROFILES-ADAPTERS.md) |
| [ADR-0005](0005-leases-fencing.md) | Conditional Redis lease dan durable fencing | [OWNERSHIP-RECOVERY](../reliability/OWNERSHIP-RECOVERY.md) |
| [ADR-0006](0006-orthogonal-state.md) | Separate execution outcome, compute, external effect, dan accounting | [EXECUTION-LIFECYCLE](../contracts/EXECUTION-LIFECYCLE.md) |
| [ADR-0007](0007-durable-accounting.md) | Transactional reservation, settlement, dan ledger authority | [ACCOUNTING](../data/ACCOUNTING.md) |
| [ADR-0008](0008-late-usage.md) | Verified late evidence dan post-window adjustment | [ACCOUNTING](../data/ACCOUNTING.md) |
| [ADR-0009](0009-stream-replay.md) | Bounded SSE replay dan durable control events | [EVENTS-STREAMING](../contracts/EVENTS-STREAMING.md) |
| [ADR-0010](0010-tool-side-effects.md) | Receiver-supported idempotency untuk mutating tools | [TOOLS-PLUGINS](../contracts/TOOLS-PLUGINS.md) |
| [ADR-0011](0011-sandbox-security.md) | Isolated compute dan server-side policy | [SECURITY](../security/SECURITY.md) |
| [ADR-0012](0012-deployment-dispatch.md) | Modular control plane dan durable dispatch | [DEPLOYMENT](../operations/DEPLOYMENT.md) |
| [ADR-0013](0013-evolution-gates.md) | Reliability gate sebelum production migration | [ACCEPTANCE](../testing/ACCEPTANCE.md) |
| [ADR-0014](0014-artifacts-sessions.md) | Immutable artifact promotion dan scoped sessions | [ARTIFACTS-SESSIONS](../contracts/ARTIFACTS-SESSIONS.md) |

## Otoritas dan traceability

Keputusan aktif dibaca dari ADR; operational semantics dirinci oleh spesifikasi terkait. [RECONCILIATION](../reviews/RECONCILIATION.md) hanya peta traceability P01–P08/M01–M10 ke ADR dan gate, bukan sumber keputusan pengganti. Riwayat review lama tersedia dalam Git; tidak diperlukan untuk menafsirkan keputusan saat ini.

## Lifecycle

Proposed -> adopted in documentation -> implementation verified, atau superseded melalui ADR baru. Keputusan historis tidak dihapus untuk menyembunyikan trade-off. Perubahan requirement memperbarui canonical specification, diagrams, tests, plan, dan traceability bersama. Bila dokumen bertentangan, selaraskan melalui ADR sebelum mengimplementasikan bagian terkait.

## Format untuk keputusan baru

Record ID/date/status, kebutuhan dan keputusan terkait, context, decision, alternatives, consequences, verification IDs, revisit trigger, dan affected documents. Tautkan langsung ke ADR terkait. Review/approval harus menunjuk revision yang sama; pemindahan rujukan dokumentasi tidak menghasilkan approval baru.
