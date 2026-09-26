# Operational Runbooks

**Design playbooks; commands/vendor consoles intentionally deployment-specific.** Do not execute destructive recovery from this document without authorized incident scope. Each action must log incident ID, actor, affected executions, and evidence. No restart/retry is assumed safe merely because worker disappeared.

## Procedures supported by the current implementation

| Incident                        | Supported local action / observation                                                                                                 | Boundary                                                                 |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| Lost management acknowledgement | Replay the same authenticated caller/key/command through the resource API; inspect receipt.replayed and historical resource revision | Seven-day replay window; expired key remains retained; no silent new key |
| Real revision conflict          | Re-read the resource and decide a new logical command with a new key if appropriate                                                  | Do not reinterpret an unrelated 409 as successful replay                 |
| Collection failure              | Retry/refresh only that resource page; cursor is bound to its collection/caller                                                      | Overview counts are independent, not a replacement for resource content  |
| Stale runner report             | Check the operator-issued assignment and durable generation; use supported grant/revoke operations with receipts                     | No automatic reaper/process kill/lease coordinator is implemented        |
| Late evidence                   | Authenticated known-assignment evidence enters QUARANTINED storage                                                                   | No automatic verifier or direct ledger posting from that intake          |
| Legacy snapshot capacity error  | Use the matching /api/v1 paginated collection                                                                                        | Never raise caps or remove projection just to hide a large dump          |

This is a description of supported source behavior, not authorization to mutate an incident environment. Do not delete receipts, clear generation barriers, or reset the database. Exact operations are in [HTTP-API](../implementation/HTTP-API.md). RB01–RB10 below remain target operational playbooks for components and integrations that are not all installed.

## RB01 — Worker orphan / expired lease

**Trigger:** lease lost, renewal denied, orphan age alert. Inspect durable assignment/current generation and coordination epoch, not worker self-report alone. Freeze new steps for affected attempt, commit quarantine/fence before replacement, revoke grants, request sandbox stop, and inspect termination evidence.

Read per-operation receipts and provider invocation state. Mutations unknown -> app owner reconciliation; retry only approved same-key safe operation with new attempt/admission. Keep residual hold until evidence/risk policy supports release. Completion condition: old generation cannot write, cleanup status explicit, replacement/reconciliation decision recorded; usage may remain pending.

## RB02 — Redis outage / epoch loss

**Trigger:** lease/replay unavailable or epoch sentinel mismatch. Suspend agent grants/renewals/new dispatch; status API may read SoR. Do not recreate leases from reports of old workers. Authorized coordinator establishes new durable epoch/revocations, reconciles active assignments, reconstructs safe projections, and only then resumes.

SSE clients receive reset/resync to snapshot when history lost. No claim lost deltas survived failover. Verify stale worker rejection and budget hold preservation before reopening admission. Avoid blanket worker kills outside affected pool/session.

## RB03 — PostgreSQL unavailable / uncertain transaction outcome

**Trigger:** admission/finalization/ledger failure. Reject new durable work; preserve bounded stream/evidence from existing in-flight calls through trusted buffering policy. Stop new paid/mutating steps that require durable intent/hold. Never switch financial authority to Redis as an emergency shortcut.

Upon recovery, reconcile idempotency by key and transaction outcome, replay outbox/inbox idempotently, inspect unresolved provider calls/holds, and run balance consistency checks. Retry command, not whole business process, unless app owner decides. Completion: no duplicate hold/credit, backlog bounded, unknown exposure visible.

## RB04 — Provider outage / throttling

**Trigger:** route errors/TTFT/429 rise. Open route breaker and apply bounded retries with jitter/Retry-After where appropriate. Protect interactive pool. Select alternate route only if profile/data/schema/budget permits and attempt state allows safe fallback.

Partial output or ambiguous acceptance: preserve attempt boundary, expose status, do not splice another provider response. Record each actual paid invocation and resolved provider/model. Restore route gradually after probe/canary; app quality baseline remains applicable.

## RB05 — Cancellation stuck / sandbox unknown

**Trigger:** cancel intent persists without verified local termination. Confirm intent durable, assigned supervisor, process tree, provider cancellation capability. Stop new dispatch, escalate local termination after configured deadline, inspect actual exit rather than signal ACK.

If compute cannot be confirmed stopped, report cleanup_pending/RECONCILING, revoke grants, and isolate pool. External mutation remains independent. Do not release all budget or state CANCELLED as proof remote effects were undone.

## RB06 — Budget overage / ledger mismatch

**Trigger:** posted charge above envelope, stale projection, disputed evidence, or unknown age. Freeze relevant new admission if available capacity exhausted; retain legitimate charge evidence. Compare canonical invocation coverage, source revisions, currency/rates, duplicate/cumulative observations, and parent-vs-child overlap.

Rebuild Redis/report projections from SoR revisions, not manual balance INCR. Correct financial facts by authorized append-only adjustment with evidence. Escalate unresolved provider/accounting issue; manual release/write-off states risk acceptance, not invented measured zero. Validate G07/G08/G15 invariants before closing.

## RB07 — Late usage quarantine

**Trigger:** late evidence beyond fast-path window or conflicting signature/source ID. Intake bounded and authenticated; preserve evidence hash/provenance. Query trusted provider record when supported, compare attempt/invocation identity and prior postings, obtain reviewer for ambiguity.

Verified late charge -> idempotent adjustment; invalid report -> rejected evidence with reason; insufficient evidence -> remains disputed/pending with escalation. Never reactivate old attempt or overwrite official result. Monitor quarantine size/age to prevent it becoming permanent financial blind spot.

## RB08 — Sandbox/credential incident

**Trigger:** forbidden host/metadata access, leaked token, unexpected egress, package digest mismatch. Revoke affected grants/credential binding, disable impacted profile versions, isolate owned sandbox/network boundary, retain audit evidence according to policy. Security owner reviews scope and external actions.

Rotate credentials through approved secret mechanism; never paste secret in tickets/docs. New deployments must pass affected security tests and demonstrate correct identity/data scope. Incident cleanup does not erase usage or external mutation history.

## RB09 — Backup restore / deployment rollback

Freeze admissions, record current deployment/coordination identity, restore SoR/object metadata using approved RPO/RTO procedure. Increment coordination epoch/revoke old assignments; reconcile outstanding provider/tool calls and reservations before dispatch. Replay retained outbox/projections idempotently.

Old worker reports are evidence only, not restored authority. Reapply deletion tombstones/retention obligations to restored payloads. Rollback profile/runtime only for supported new attempts; incompatible sessions require restart. Completion: restore drill checks ledger, idempotency, artifacts, stale writes, and app rollback behavior.

## RB10 — Stream replay gap

Check earliest cursor, stream epoch, retention/byte eviction, and execution snapshot. Client reconnect in window replays/dedups; out of window returns explicit reset/snapshot. No automatic new execution to reconstruct missing text. Investigate slow-client memory pressure and adjust approved caps, not unbounded buffer growth.

## Ownership and escalation

Platform on-call handles dispatch/storage; app owner resolves domain outcome; security handles credential/exfiltration; accounting owner approves adjustment/write-off. Named contacts, timers, regions, console procedures, and communication channels remain deployment decisions O02–O07 before production.

## Runner fleet and AI connection operations

**Drain runner:** set durable state DRAINING, hentikan placement baru, amati in-flight attempts sampai selesai/reconciled, lalu shutdown. Jangan menghapus lease/fence untuk mempercepat drain.

**Runner unexpectedly offline:** remove node dari eligible placement berdasarkan lease/liveness, inspect in-flight attempts, jalankan orphan reconciliation/fencing, dan redispatch hanya jika retry policy aman.

**Revoke AI connection/credential:** disable binding/instance secara durable, hentikan new placement, rotate/revoke secret di authority asal, lalu audit active executions yang mungkin sudah menerima credential. Jangan menganggap UI disable membatalkan provider call yang sudah diterima.

**Shared quota saturation:** throttle seluruh bindings dalam quota group, bukan hanya runner yang pertama menerima 429. Verify provider scope sebelum menaikkan capacity.

**Plugin revoke:** tandai version revoked untuk new admission, jangan mutate artifact lama; inspect executions yang sedang berjalan dan gunakan cancellation policy bila security incident mengharuskan.
