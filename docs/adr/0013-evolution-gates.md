# ADR-0013 — Reliability gate sebelum production migration

**Tanggal:** 20 September 2026  
**Status:** adopted for documentation baseline 0.2; implementation NOT VERIFIED.  
**Dasar:** P06/P08; M08. Amendments terhadap principal tetap membutuhkan disposition O11; ini bukan signature baru principal.

## Context

Original roadmap moved core reliability after app migration. Principal gate addresses this but illustrative timing/accuracy claims need measurable scope.

## Decision

Core controls built with P1/P2/P3, verified P3.5 before production cutover. Twenty-five applicable scenarios include principal five plus review correctness gaps. Record actual evidence, parameters, owner, and unresolved risks. Controlled canary/rollback per app. Codex/Gemini added through same conformance/security/quality gates.

## Alternatives considered

Migrate first and harden later ditolak. Sign-off text or passing Markdown check as production readiness ditolak. Arbitrary SLO percentages without units/window ditolak.

## Consequences and trade-offs

Launch delayed if safety/data/credential evidence missing. Nonproduction prototypes still possible within approved limits. Documentation and implementation statuses kept separate.

## Verification

[ACCEPTANCE](../testing/ACCEPTANCE.md), [PLAN](../../PLAN.md), [ROADMAP](../../ROADMAP.md).

## Evolution / revisit trigger

Repeat affected gates for each provider/runtime/profile change; version future decision rather than silently weakening criteria.

Provenance: [reconciliation register](../reviews/RECONCILIATION.md). Decision gaps: [OPEN-QUESTIONS](../decisions/OPEN-QUESTIONS.md).
