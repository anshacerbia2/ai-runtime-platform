# ADR-0014 — Immutable artifact promotion dan scoped sessions

**Tanggal:** 20 September 2026  
**Status:** adopted for documentation baseline 0.2; implementation NOT VERIFIED.  
**Dasar:** Elaborasi baseline dari app/runtime boundary. Amendments terhadap principal tetap membutuhkan disposition O11; ini bukan signature baru principal.

## Context

Agent generates files and runtime sessions, but upload success or shared session ID must not bypass fencing/authorization. Cross-runtime memory portability unproven.

## Decision

Artifact uploads scoped and verified; official manifest promoted by fenced finalization. Orphan objects cleaned independently from external/usage evidence. App owns conversation; optional runtime session single-writer, scoped, version-bound with optimistic revision. Cross-runtime restart explicit; no transparent session migration promise.

## Alternatives considered

Arbitrary caller filesystem paths/shared writable workspace ditolak. Reconstruct final result only from Redis deltas ditolak. Global session ID without tenant ownership ditolak.

## Consequences and trade-offs

Object and DB failure windows require idempotent finalize/cleanup. Session conflicts exposed to caller; version upgrades may require new session. Retention/deletion includes checkpoints and backups.

## Verification

G19/G20/G24; [ARTIFACTS-SESSIONS](../contracts/ARTIFACTS-SESSIONS.md).

## Evolution / revisit trigger

Future artifact sharing/session branching requires explicit grants and compatible checkpoint proof.

Provenance: [reconciliation register](../reviews/RECONCILIATION.md). Decision gaps: [OPEN-QUESTIONS](../decisions/OPEN-QUESTIONS.md).
