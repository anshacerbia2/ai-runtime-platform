# ADR-0008 — Verified late evidence dan post-window adjustment

**Tanggal:** 20 September 2026  
**Status:** design adopted for baseline 0.2; current implementation coverage is stated below, not a blanket production verification.\
**Dasar:** pemisahan state authority [ADR-0005](0005-leases-fencing.md) dari verifikasi dan settlement [ADR-0007](0007-durable-accounting.md). Review baseline tetap dilacak melalui O11.

## Implementation reconciliation — 24 September 2026

Known old runner assignments can submit deduplicated evidence into QUARANTINED storage. Automatic provider verification, age-window processing and quarantine-to-ledger workflow are not implemented. See [current source state](../implementation/CURRENT-STATE.md), [active HTTP operations](../implementation/HTTP-API.md), and [verification scope](../reviews/CONTRACT-EXECUTION.md). This note updates implementation status only; it does not create new reviewer approval or erase the original decision history.

## Context

Stale worker tidak boleh mengubah outcome, tetapi mungkin memiliki valid usage. Fifteen-minute cutoff melindungi fast path, bukan menentukan kebenaran biaya.

## Decision

Evidence intake independent of authority. Candidate 15m fast verification window; older evidence bounded quarantine/audit review. Verify attribution/source/completeness, dedup updates, permit authorized idempotent adjustment afterward. SETTLED_FROM_ORPHAN dipetakan ke settlement plus provenance, bukan otomatis trusted financial status.

## Alternatives considered

Drop all stale usage ditolak. Accept any signed worker charge directly ditolak. Fixed time window sebagai bukti charge invalid ditolak.

## Consequences and trade-offs

Memerlukan reconciliation queue/owner dan age alerts. Unknown/disputed costs terlihat; tidak dapat mengklaim precision yang tidak tersedia provider. Late adjustments tidak reopen execution.

## Verification

G12/G15; [ACCOUNTING](../data/ACCOUNTING.md).

## Evolution / revisit trigger

Window/intake policy configurable sesuai threat/retention; accounting evidence rules tetap explicit.

Navigasi keputusan: [ADR index](README.md). Peta pendukung: [traceability](../reviews/RECONCILIATION.md). Decision gaps: [OPEN-QUESTIONS](../decisions/OPEN-QUESTIONS.md).
