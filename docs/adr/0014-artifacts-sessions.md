# ADR-0014 — Immutable artifact promotion dan scoped sessions

**Tanggal:** 20 September 2026  
**Status:** design adopted for baseline 0.2; current implementation coverage is stated below, not a blanket production verification.\
**Dasar:** app/runtime boundary [ADR-0001](0001-application-ownership.md), fencing [ADR-0005](0005-leases-fencing.md), dan isolation [ADR-0011](0011-sandbox-security.md). Review baseline tetap dilacak melalui O11.

## Implementation reconciliation — 24 September 2026

Application-scoped artifact metadata is implemented. Object uploads/final manifests, runtime checkpoints and single-writer agent sessions remain planned; BFF login sessions are a different feature. See [current source state](../implementation/CURRENT-STATE.md), [active HTTP operations](../implementation/HTTP-API.md), and [verification scope](../reviews/CONTRACT-EXECUTION.md). This note updates implementation status only; it does not create new reviewer approval or erase the original decision history.

## Context

Agent generates files and runtime sessions, but upload success or shared session ID must not bypass fencing/authorization. Cross-runtime memory portability unproven.

## Decision

Artifact uploads scoped and verified; official manifest promoted by fenced finalization. Orphan objects cleaned independently from external/usage evidence. App owns conversation; optional runtime session single-writer, scoped, version-bound with optimistic revision. Cross-runtime restart explicit; no transparent session migration promise.

## Alternatives considered

Arbitrary caller filesystem paths/shared writable workspace ditolak. Reconstruct final result only from Redis deltas ditolak. Global session ID without application ownership ditolak.

## Consequences and trade-offs

Object and DB failure windows require idempotent finalize/cleanup. Session conflicts exposed to caller; version upgrades may require new session. Retention/deletion includes checkpoints and backups.

## Verification

G19/G20/G24; [ARTIFACTS-SESSIONS](../contracts/ARTIFACTS-SESSIONS.md).

## Evolution / revisit trigger

Future artifact sharing/session branching requires explicit grants and compatible checkpoint proof.

Navigasi keputusan: [ADR index](README.md). Peta pendukung: [traceability](../reviews/RECONCILIATION.md). Decision gaps: [OPEN-QUESTIONS](../decisions/OPEN-QUESTIONS.md).
