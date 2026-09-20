# Architecture Decision Records

**Baseline 0.2 · 20 September 2026.** ADR mencatat konteks, keputusan, alternatif, konsekuensi, verification, dan revisit trigger. Adopted in documentation baseline tidak berarti implemented/tested atau principal menyetujui amendment baru. O11 menangani review amendments.

| ADR | Decision | Basis |
| --- | --- | --- |
| [ADR-0001 — Application-owned workflow dan AI execution boundary](0001-application-ownership.md) | Application-owned workflow dan AI execution boundary | SRC-U; P01 |
| [ADR-0002 — Managed Execution Envelope dan typed profiles](0002-managed-envelope.md) | Managed Execution Envelope dan typed profiles | P01; elaborasi baseline |
| [ADR-0003 — Tiered Storage dan authoritative data paths](0003-tiered-storage.md) | Tiered Storage dan authoritative data paths | P02; M07/M09 |
| [ADR-0004 — OpenRouter-first dan dual-adapter proof](0004-routing-dual-adapter.md) | OpenRouter-first dan dual-adapter proof | P03/P08 |
| [ADR-0005 — Conditional Redis lease dan durable fencing](0005-leases-fencing.md) | Conditional Redis lease dan durable fencing | P04; M03/M07 |
| [ADR-0006 — Separate execution outcome, compute, external effect, dan accounting](0006-orthogonal-state.md) | Separate execution outcome, compute, external effect, dan accounting | P05; M01 |
| [ADR-0007 — Transactional reservation, settlement, dan ledger authority](0007-durable-accounting.md) | Transactional reservation, settlement, dan ledger authority | P02 reserve-execute-settle; M02/M05/M06 |
| [ADR-0008 — Verified late evidence dan post-window adjustment](0008-late-usage.md) | Verified late evidence dan post-window adjustment | P04; M04 |
| [ADR-0009 — Bounded SSE replay dan durable control events](0009-stream-replay.md) | Bounded SSE replay dan durable control events | P02/P06; elaborasi bounded replay |
| [ADR-0010 — Receiver-supported idempotency untuk mutating tools](0010-tool-side-effects.md) | Receiver-supported idempotency untuk mutating tools | P07; M10 |
| [ADR-0011 — Isolated compute dan server-side policy](0011-sandbox-security.md) | Isolated compute dan server-side policy | P01/P06; security elaboration |
| [ADR-0012 — Modular control plane dan durable dispatch](0012-deployment-dispatch.md) | Modular control plane dan durable dispatch | Elaborasi baseline; M07/M09 |
| [ADR-0013 — Reliability gate sebelum production migration](0013-evolution-gates.md) | Reliability gate sebelum production migration | P06/P08; M08 |
| [ADR-0014 — Immutable artifact promotion dan scoped sessions](0014-artifacts-sessions.md) | Immutable artifact promotion dan scoped sessions | Elaborasi baseline dari app/runtime boundary |

## Lifecycle

Proposed -> adopted in documentation -> implementation verified, atau superseded melalui ADR baru. Historical decision tidak dihapus untuk menyembunyikan trade-off. Perubahan requirement memperbarui canonical specification, diagrams, tests, plan, dan traceability bersama.

## Format untuk keputusan baru

Record ID/date/status, source/provenance, context, decision, alternatives, consequences, verification IDs, revisit trigger, dan affected documents. Jangan memberi status accepted by principal tanpa bukti review yang menunjuk revision yang sama.
