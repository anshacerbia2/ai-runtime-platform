# ADR-0005 — Conditional Redis lease dan durable fencing

**Tanggal:** 20 September 2026  
**Status:** adopted for documentation baseline 0.2; implementation NOT VERIFIED.  
**Dasar:** P04; M03/M07. Amendments terhadap principal tetap membutuhkan disposition O11; ini bukan signature baru principal.

## Context

Lease expiry bisa terjadi saat process/remote operation masih hidup. Bare SET renewal dapat membuat ulang lease hilang. Redis check dan PG commit bukan transaksi tunggal.

## Decision

PG mengalokasikan current assignment/generation/coordination epoch. Supervisor menerbitkan Redis lease; renewal hanya extend key existing dengan exact owner/generation/epoch/nonce. Missing/mismatch berarti loss. No periodic heartbeat PG writes. Durable revocation CAS mendahului reassignment; old generation ditolak setelah fence. Epoch rebuild fail-closed ketika Redis state tidak dapat dipercaya. Late usage terpisah.

## Alternatives considered

Timeout lalu automatic retry tanpa quarantine ditolak. Redis-only fencing counter ditolak. Mengklaim strict atomic expiry lintas Redis/PG ditolak. Stronger coordinator tetap opsi future bila requirement menuntut.

## Consequences and trade-offs

Failure dapat menurunkan availability karena pause/quarantine. Tidak ada exactly-once side effect hanya dari lock. Finalization race didefinisikan oleh durable CAS, bukan wall clock worker.

## Verification

G04/G05/G06/G23; [OWNERSHIP-RECOVERY](../reliability/OWNERSHIP-RECOVERY.md).

## Evolution / revisit trigger

Topology failover/epoch assumptions wajib diuji; perubahan coordinator atau stronger expiry semantics memerlukan ADR dan fault tests.

Provenance: [reconciliation register](../reviews/RECONCILIATION.md). Decision gaps: [OPEN-QUESTIONS](../decisions/OPEN-QUESTIONS.md).
