# ADR-0031 — Pull dispatch and scoped runner grants

**Tanggal:** 29 September 2026
**Status:** adopted; initial placement, boot-bound grant, and lease-gated reports implemented locally; reassignment and payload delivery pending.
**Dasar:** [ADR-0005](0005-leases-fencing.md), [ADR-0012](0012-deployment-dispatch.md), [ADR-0022](0022-distributed-runner-fleet.md), [ADR-0029](0029-replay-resources-runner-authority.md), [ADR-0030](0030-encrypted-dispatch-envelope.md).

## Context

`agent_execute` admission can already create a durable execution, attempt, reservation, and committed encrypted dispatch envelope. Manual runner assignment proves generation fencing, but it does not select an eligible runner or give a live runner an autonomous way to obtain work. Placement must respect current policy and runner-local credential locality without making Redis liveness an authority or exposing object-store/KMS credentials.

The first dispatcher slice also needs a safe boundary for duplicate polls and concurrent coordinators. Automatic reassignment cannot be enabled until lease loss, epoch recovery, old-process termination, and ambiguous external effects have a reconciler.

## Decision

Runner protocol v1 uses a pull claim: `POST /api/runner/v1/dispatches/claim`. The request carries runner ID, process boot UUID, and exact registration revision. The authenticated owner and revision are verified against PostgreSQL; the exact boot must have a current Redis/in-memory presence proof. Missing or mismatched presence rejects the claim, and coordination failure pauses dispatch.

PostgreSQL remains placement and assignment authority. In one Read Committed transaction the repository locks the candidate execution, then current application/connection policy, runner, and pool rows. A new grant requires an `AGENT` admission, an `ACCEPTED` uncancelled execution, generation zero, a prepared unassigned attempt, an unexpired `COMMITTED` envelope, an enabled application/connection/binding, matching environment, pool and runner lifecycle, minimum runner version, `agent_execute` capability, advertised connection locality, capacity, and an eligible central or runner-local credential. Policy rows are re-read after their locks, so a policy change that owns the ordering point first is observed by placement.

Candidate order is oldest creation time then ID, with a bounded scan. `FOR UPDATE SKIP LOCKED` lets concurrent coordinators make progress without issuing two grants for one execution. The runner row lock serializes capacity decisions for that node. A successful initial placement atomically increments execution generation, owns the attempt, creates `RunnerAssignment`, audit metadata, and a sanitized outbox event.

`RunnerAssignment` is the scoped durable delivery authority. The claim response adds only envelope ID, input digest, plaintext byte count, and envelope expiry to the assignment identity. It does not return object key, wrapped/plaintext data key, input, provider credential, or broad storage access. An autonomous grant persists the claiming process boot UUID. Repeated claims replay the runner's oldest still-valid `GRANTED` assignment only to that same current boot. The coordinator checks presence again after placement and withholds a grant if another boot superseded it during the transaction. A replacement boot cannot obtain that grant through claim; it remains for explicit reconciliation. Existing invalid/stale grants fail closed rather than silently moving work.

Only initial generation-zero placement is automatic. `automaticReassignment` remains false. Redis presence is a liveness projection; losing it cannot create, revoke, or transfer durable authority. The runner activates a claimed assignment through `POST /api/runner/v1/leases/activate` with exact assignment token, registration revision, boot UUID, and random nonce. PostgreSQL validates current generation/epoch/owner/boot and stores only the nonce digest. The first activation installs a 15-second Redis lease; subsequent calls renew only an existing exact lease. A lost key cannot be recreated for an activated assignment. Failed cross-store setup may leave a short-lived Redis key or a durable grant needing reconciliation; it never authorizes a second owner.

For `AGENT` reports, the application boundary checks exact current boot presence and Redis lease before the durable report transaction. That transaction checks the stored nonce digest, boot, registration revision, generation, epoch, and cancellation/fence state before changing `started` or `result.proposed`. Missing lease, mismatched nonce, or stale authority fails closed. Manual non-agent assignment reports retain their existing behavior. Redis inspection and PostgreSQL commit are not one atomic operation; durable CAS remains the final write fence. There is still no sandbox/process supervisor, lease-loss reaper, epoch rebuild, or automatic reassignment. The future coordinator delivery path must recheck the assignment and envelope, read/decrypt through production KMS, and send payload over a bounded scoped channel without giving the runner object-store credentials.

## Alternatives considered

Coordinator push was deferred because runner pull gives natural backpressure and avoids requiring inbound connectivity to every runner. A second bearer grant table/token was rejected because the existing assignment already binds runner, owner, execution, attempt, generation, and epoch durably. Redis-only queues or capacity counters were rejected as assignment authority because expiry/failover could duplicate ownership. Returning a presigned object URL or wrapped key was rejected because it broadens credential and revocation surfaces.

## Consequences and trade-offs

Initial placement is autonomous and deterministic for eligible work, while actual agent execution is still unavailable. Database locks are intentionally on the correctness path; fleet-scale fairness and contention need measurement before adding a broker or cached eligibility index. Oldest-first ordering is local to the bounded candidate set and is not a global fair scheduler.

One runner-local credential test proves that a live otherwise-compatible runner without the local credential cannot claim the execution. It does not yet prove cross-region scheduling, drain/failover, quota-group fairness, or replacement after node loss. A `GRANTED` assignment consumes capacity until report, revocation, or future reconciliation resolves it.

## Verification

Unit tests cover exact process boot, fail-closed coordination access, and a boot replacement during placement. PostgreSQL integration covers no-heartbeat and wrong-boot rejection, replacement-boot replay denial, runner-local credential exclusion, binding revocation, concurrent claim deduplication, competing lease nonces, same-boot replay, no-lease report denial, lease-backed start, lost-key no-recreate, and sanitized outbox/grant fields. HTTP integration covers registered machine-only routes and protocol flags. Real Redis conformance checks exact lease/presence behavior across two clients; an end-to-end multi-coordinator lease activation test remains pending.

## Revisit trigger

Revisit before automatic reassignment, payload delivery, production KMS integration, lease-driven recovery, multi-pool fairness, or a broker replaces direct pull. Any replacement must retain PostgreSQL generation/epoch authority, exact process presence, policy ordering, and sanitized grants.

Navigasi keputusan: [ADR index](README.md). Runtime status: [CURRENT-STATE](../implementation/CURRENT-STATE.md). Lifecycle: [EXECUTION-LIFECYCLE](../contracts/EXECUTION-LIFECYCLE.md).
