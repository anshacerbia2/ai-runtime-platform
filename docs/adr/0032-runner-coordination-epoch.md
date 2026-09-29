# ADR-0032 — Durable runner coordination epoch after Redis state loss

**Tanggal:** 30 September 2026
**Status:** implemented locally; production failover gate pending
**Dasar:** [ADR-0005](0005-leases-fencing.md), [ADR-0031](0031-pull-dispatch-and-scoped-runner-grants.md), [ownership recovery](../reliability/OWNERSHIP-RECOVERY.md).

## Context

An exact Redis lease prevents a runner from recreating one lost key. A Redis restart can remove the marker and many lease keys at once, while PostgreSQL still holds current assignments. Treating this as ordinary lease expiry allows new placement before the older assignments have been fenced. PostgreSQL and Redis cannot commit one atomic transaction.

## Decision

Production coordination uses one PostgreSQL row with `ACTIVE|PAUSED`, monotonic epoch, and a random marker. Redis holds the marker in the dedicated M3 coordination database. A missing or different marker pauses the row with a compare-and-set update. A Redis transport failure rejects the request without asserting that state was lost. The migration starts `PAUSED`, so deployment cannot grant work before the first reconciliation.

Runner claim and lease/report paths inspect the marker. Claim holds a PostgreSQL share lock on the coordination row through grant commit, checks `ACTIVE`, and copies the current epoch into the execution and assignment. Lease confirmation and report commit also check the active epoch under a share lock. A pause update waits for earlier share-lock holders; later writes see `PAUSED`. Local `m0-local` mode keeps its deterministic in-memory coordination behavior and does not claim a distributed epoch guarantee.

While paused, a bounded scan fences all current autonomous `AGENT` grants, including `RESULT_PROPOSED`, even if their Redis lease still exists. Each execution-row-locked transition suspends the attempt, advances the generation barrier, marks the execution `RECONCILING`, and retains budget holds and proposals for review. Reopening takes the PostgreSQL coordination row lock, verifies that no current active assignments remain, writes a fresh Redis marker, then commits `ACTIVE` with a higher epoch. A Redis write followed by PostgreSQL rollback leaves the database paused; retry can choose another marker without granting duplicate authority. Multiple coordinators serialize on the same row.

Epoch recovery does not kill an old sandbox, verify external effects, settle usage, or authorize automatic reassignment. A process that has already crossed an external boundary remains an unresolved effect until reconciliation. Production rollout must quiesce coordinators that do not implement the epoch row lock; mixed-version writers are outside this proof.

## Alternatives considered

Recreating every lost Redis lease from PostgreSQL was rejected because the old process may still execute and Redis loss does not prove termination. A Redis-only epoch counter was rejected because failover can lose or roll it back. Automatically retrying after pause was rejected because tool/provider effects can be ambiguous.

## Verification and limits

Unit tests cover missing marker versus transport outage and the pause/fence/reopen sequence. PostgreSQL integration covers an epoch fence while an exact lease still exists, late report rejection, and retained reconciliation state. The CI Redis conformance step covers two coordinators observing one marker and advancing the durable epoch after deletion. A real Redis restart/failover with active sandbox processes, old-worker resurrection, timing bounds, and operational rollout remains required for G04/G06 and P3.5.

## Revisit trigger

Revisit if the Redis HA topology can restore an old marker and old lease keys together, if automatic replacement is enabled, or if stronger cross-store linearizability is required. A different coordinator must preserve durable fencing and explicit unknown external effects.
