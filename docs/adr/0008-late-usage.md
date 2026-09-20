# ADR-0008 — Verified late evidence dan post-window adjustment

**Tanggal:** 20 September 2026  
**Status:** adopted for documentation baseline 0.2; implementation NOT VERIFIED.  
**Dasar:** P04; M04. Amendments terhadap principal tetap membutuhkan disposition O11; ini bukan signature baru principal.

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

Provenance: [reconciliation register](../reviews/RECONCILIATION.md). Decision gaps: [OPEN-QUESTIONS](../decisions/OPEN-QUESTIONS.md).
