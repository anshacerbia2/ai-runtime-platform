# ADR-0013 — Reliability gate sebelum production migration

**Tanggal:** 20 September 2026  
**Status:** adopted for documentation baseline 0.2; implementation NOT VERIFIED.  
**Dasar:** bukti reliability, security, dan accounting sebelum migrasi produksi; terkait [ADR-0005](0005-leases-fencing.md), [ADR-0007](0007-durable-accounting.md), dan [ADR-0011](0011-sandbox-security.md). Review baseline tetap dilacak melalui O11.

## Context
Roadmap awal menempatkan core reliability setelah migrasi aplikasi. Gate harus mendahului produksi; target timing/accuracy memerlukan ruang lingkup pengukuran yang jelas.

## Decision
Core controls built with P1/P2/P3, verified P3.5 before production cutover. Twenty-five applicable scenarios cover worker chaos, SSE, budget race, late usage, sandbox, and operational correctness gaps. Record actual evidence, parameters, owner, and unresolved risks. Controlled canary/rollback per app. Codex/Gemini added through same conformance/security/quality gates.

## Alternatives considered

Migrate first and harden later ditolak. Sign-off text or passing Markdown check as production readiness ditolak. Arbitrary SLO percentages without units/window ditolak.

## Consequences and trade-offs

Launch delayed if safety/data/credential evidence missing. Nonproduction prototypes still possible within approved limits. Documentation and implementation statuses kept separate.

## Verification

[ACCEPTANCE](../testing/ACCEPTANCE.md), [PLAN](../PLAN.md), [ROADMAP](../ROADMAP.md).

## Evolution / revisit trigger

Repeat affected gates for each provider/runtime/profile change; version future decision rather than silently weakening criteria.

Navigasi keputusan: [ADR index](README.md). Peta pendukung: [traceability](../reviews/RECONCILIATION.md). Decision gaps: [OPEN-QUESTIONS](../decisions/OPEN-QUESTIONS.md).
