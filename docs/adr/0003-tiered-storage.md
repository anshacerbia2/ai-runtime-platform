# ADR-0003 — Tiered Storage dan authoritative data paths

**Tanggal:** 20 September 2026  
**Status:** adopted for documentation baseline 0.2; implementation NOT VERIFIED.  
**Dasar:** P02; M07/M09. Amendments terhadap principal tetap membutuhkan disposition O11; ini bukan signature baru principal.

## Context

Live deltas, heartbeat, control records, financial facts, dan large artifacts mempunyai failure/retention needs berbeda. Source diagram belum memisahkan semua authority boundaries.

## Decision

PostgreSQL menyimpan durable state, discrete control events, reservation/ledger/outbox. Redis menangani heartbeat/replay/rate windows/projections; no model.delta rows atau periodic heartbeat UPDATE ke PG. Object store menyimpan artifacts/approved traces. App tidak langsung mengakses backing stores. Final output tidak bergantung pada replay buffer.

## Alternatives considered

Semua live deltas di relational transactional path tidak dipilih. Semua state hanya Redis tidak dipilih. Redis Cluster wajib tanpa requirement topology tidak dipilih.

## Consequences and trade-offs

Ada lebih dari satu datastore dan recovery contract harus eksplisit. Stream dapat reset saat hot state hilang; durable facts harus tetap dapat dipulihkan. Kapasitas/test menentukan topology.

## Verification

G09/G11/G19/G23/G24; [DATA-MODEL](../data/DATA-MODEL.md).

## Evolution / revisit trigger

Ekstraksi broker/log khusus diperbolehkan bila measured capacity/retention perlu; authority invariants tetap.

Provenance: [reconciliation register](../reviews/RECONCILIATION.md). Decision gaps: [OPEN-QUESTIONS](../decisions/OPEN-QUESTIONS.md).
