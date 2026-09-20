# ADR-0007 — Transactional reservation, settlement, dan ledger authority

**Tanggal:** 20 September 2026  
**Status:** adopted for documentation baseline 0.2; implementation NOT VERIFIED.  
**Dasar:** P02 reserve-execute-settle; M02/M05/M06. Amendments terhadap principal tetap membutuhkan disposition O11; ini bukan signature baru principal.

## Context

Redis decrement lalu reject dapat mengubah denied balance; release Redis sebelum PG ledger memiliki crash/duplicate-credit gap. Single token-pair estimate tidak mencakup multi-turn agent.

## Decision

PG transaction owns budget accounts/holds/admission/idempotency/outbox. Rejection no balance mutation. Settlement/adjustment/hold release/outbox committed together; Redis revisioned projection only. Use fixed monetary units, canonical invocation evidence, multi-scope atomic checks. Whole-run envelope atau enforceable tranches cover retries/turns/tools; incomplete exposure remains held/pending.

## Alternatives considered

Redis-only financial pool ditolak untuk baseline. Cross-store best-effort release/write ditolak. Hard exact-dollar abort universal ditolak. Escrow/sharded fast budget dapat dievaluasi nanti dengan conservation proof.

## Consequences and trade-offs

Budget accounts dapat menjadi contention point; transaksi bounded dan load test wajib. Actual unexpected overage tetap dicatat meski limit terlampaui. No provider calls while DB transaction held.

## Verification

G07/G08/G09/G15/G25; [ACCOUNTING](../data/ACCOUNTING.md).

## Evolution / revisit trigger

Optimasi tidak boleh menghilangkan durable-before-dispatch dan idempotent adjustment; topology baru membutuhkan crash/property tests.

Provenance: [reconciliation register](../reviews/RECONCILIATION.md). Decision gaps: [OPEN-QUESTIONS](../decisions/OPEN-QUESTIONS.md).
