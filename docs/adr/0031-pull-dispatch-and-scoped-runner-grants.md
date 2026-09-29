# ADR-0031 — Pull dispatch and scoped runner grants

**Tanggal:** 29 September 2026
**Status:** adopted; initial autonomous placement and grant claim implemented locally, reassignment and payload delivery pending.
**Dasar:** [ADR-0005](0005-leases-fencing.md), [ADR-0012](0012-deployment-dispatch.md), [ADR-0022](0022-distributed-runner-fleet.md), [ADR-0029](0029-replay-resources-runner-authority.md), [ADR-0030](0030-encrypted-dispatch-envelope.md).

## Context

`agent_execute` admission can already create a durable execution, attempt, reservation, and committed encrypted dispatch envelope. Manual runner assignment proves generation fencing, but it does not select an eligible runner or give a live runner an autonomous way to obtain work. Placement must respect current policy and runner-local credential locality without making Redis liveness an authority or exposing object-store/KMS credentials.

The first dispatcher slice also needs a safe boundary for duplicate polls and concurrent coordinators. Automatic reassignment cannot be enabled until lease loss, epoch recovery, old-process termination, and ambiguous external effects have a reconciler.

## Decision

Runner protocol v1 uses a pull claim: `POST /api/runner/v1/dispatches/claim`. The request carries runner ID, process boot UUID, and exact registration revision. The authenticated owner and revision are verified against PostgreSQL; the exact boot must have a current Redis/in-memory presence proof. Missing or mismatched presence rejects the claim, and coordination failure pauses dispatch.

PostgreSQL remains placement and assignment authority. In one Read Committed transaction the repository locks the candidate execution, then current application/connection policy, runner, and pool rows. A new grant requires an `AGENT` admission, an `ACCEPTED` uncancelled execution, generation zero, a prepared unassigned attempt, an unexpired `COMMITTED` envelope, an enabled application/connection/binding, matching environment, pool and runner lifecycle, minimum runner version, `agent_execute` capability, advertised connection locality, capacity, and an eligible central or runner-local credential. Policy rows are re-read after their locks, so a policy change that owns the ordering point first is observed by placement.

Candidate order is oldest creation time then ID, with a bounded scan. `FOR UPDATE SKIP LOCKED` lets concurrent coordinators make progress without issuing two grants for one execution. The runner row lock serializes capacity decisions for that node. A successful initial placement atomically increments execution generation, owns the attempt, creates `RunnerAssignment`, audit metadata, and a sanitized outbox event.

`RunnerAssignment` is the scoped durable delivery authority. The claim response adds only envelope ID, input digest, plaintext byte count, and envelope expiry to the assignment identity. It does not return object key, wrapped/plaintext data key, input, provider credential, or broad storage access. Repeated claims replay the runner's oldest still-valid `GRANTED` assignment. Existing invalid/stale grants fail closed for reconciliation rather than silently moving work.

Only initial generation-zero placement is automatic. `automaticReassignment` remains false. Redis presence is a liveness projection; losing it cannot create, revoke, or transfer durable authority. The future coordinator delivery path must recheck the assignment and envelope, read/decrypt through production KMS, and send payload over a bounded scoped channel without giving the runner object-store credentials.

## Alternatives considered

Coordinator push was deferred because runner pull gives natural backpressure and avoids requiring inbound connectivity to every runner. A second bearer grant table/token was rejected because the existing assignment already binds runner, owner, execution, attempt, generation, and epoch durably. Redis-only queues or capacity counters were rejected as assignment authority because expiry/failover could duplicate ownership. Returning a presigned object URL or wrapped key was rejected because it broadens credential and revocation surfaces.

## Consequences and trade-offs

Initial placement is autonomous and deterministic for eligible work, while actual agent execution is still unavailable. Database locks are intentionally on the correctness path; fleet-scale fairness and contention need measurement before adding a broker or cached eligibility index. Oldest-first ordering is local to the bounded candidate set and is not a global fair scheduler.

One runner-local credential test proves that a live otherwise-compatible runner without the local credential cannot claim the execution. It does not yet prove cross-region scheduling, drain/failover, quota-group fairness, or replacement after node loss. A `GRANTED` assignment consumes capacity until report, revocation, or future reconciliation resolves it.

## Verification

Unit tests cover exact process boot and fail-closed coordination access. PostgreSQL integration covers no-heartbeat and wrong-boot rejection, runner-local credential exclusion, binding revocation, two concurrent claims producing one durable assignment, idempotent grant replay, capacity ownership, and sanitized outbox/grant fields. HTTP integration covers the registered machine-only route and protocol flags. Real Redis conformance checks exact boot mismatch across two clients.

## Revisit trigger

Revisit before automatic reassignment, payload delivery, production KMS integration, lease-driven recovery, multi-pool fairness, or a broker replaces direct pull. Any replacement must retain PostgreSQL generation/epoch authority, exact process presence, policy ordering, and sanitized grants.

Navigasi keputusan: [ADR index](README.md). Runtime status: [CURRENT-STATE](../implementation/CURRENT-STATE.md). Lifecycle: [EXECUTION-LIFECYCLE](../contracts/EXECUTION-LIFECYCLE.md).
