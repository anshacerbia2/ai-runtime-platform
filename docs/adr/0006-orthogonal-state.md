# ADR-0006 — Separate execution outcome, compute, external effect, dan accounting

**Tanggal:** 20 September 2026  
**Status:** adopted for documentation baseline 0.2; implementation NOT VERIFIED.  
**Dasar:** pemisahan outcome dan ownership [ADR-0001](0001-application-ownership.md), serta accounting [ADR-0007](0007-durable-accounting.md). Review baseline tetap dilacak melalui O11.

## Context
Empat dimensi status harus tetap independen. Syarat sukses external COMMITTED sekaligus accounting SETTLED akan menghalangi chat dengan external NONE dan hasil yang billing-nya terlambat.

## Decision
Gunakan public execution status plus attempt dimensions authority/local compute/external/accounting. Completion memerlukan valid final result dan technical outcome, bukan settlement. Direct compute NOT_APPLICABLE, ordinary exit EXITED, finalized authority RELEASED sah. Unknown external effect dan pending cost tetap terlihat setelah terminal execution. No forced SIGKILL for ordinary failure.

## Alternatives considered

Satu enum menyatukan semua facts ditolak. Menunggu billing sebelum memberikan hasil ditolak. Terminal berarti seluruh remote activity pasti berhenti ditolak.

## Consequences and trade-offs

Client harus membaca reason/uncertainty flags, bukan hanya status string. Snapshot/API lebih rinci tetapi tidak menyembunyikan ambiguity. Business acceptance tetap terpisah.

## Verification

G13/G21; [EXECUTION-LIFECYCLE](../contracts/EXECUTION-LIFECYCLE.md).

## Evolution / revisit trigger

Enum evolution backward-compatible; new dimensions require schema/reviewer update, not ad hoc status strings.

Navigasi keputusan: [ADR index](README.md). Peta pendukung: [traceability](../reviews/RECONCILIATION.md). Decision gaps: [OPEN-QUESTIONS](../decisions/OPEN-QUESTIONS.md).
