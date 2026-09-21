# ADR-0014 — Immutable artifact promotion dan scoped sessions

**Tanggal:** 20 September 2026  
**Status:** adopted for documentation baseline 0.2; implementation NOT VERIFIED.  
**Dasar:** app/runtime boundary [ADR-0001](0001-application-ownership.md), fencing [ADR-0005](0005-leases-fencing.md), dan isolation [ADR-0011](0011-sandbox-security.md). Review baseline tetap dilacak melalui O11.

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
