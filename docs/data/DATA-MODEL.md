# Logical Data Model dan Persistence Contracts

**Baseline 0.2; logical schema, bukan DDL/migration yang sudah dibuat.** Money semantics ada di [ACCOUNTING](ACCOUNTING.md), state enum di [LIFECYCLE](../contracts/EXECUTION-LIFECYCLE.md).

## 1. Entity catalogue

| Entity | Identity/important fields | Constraints / owner |
| --- | --- | --- |
| applications | app_id, tenant bindings, service principal, status | Identity policy service; no raw secret |
| execution_profiles | profile_id, revision, content digest, policy refs, state | Immutable published revision |
| executions | execution_id, tenant/app, optional process/step/conversation, profile revision, public status/revision, current attempt/generation | Scoped reads; monotonic durable revision |
| idempotency_records | tenant/app/family/key, request digest, execution_id, expiry/tombstone | Unique scope+key; never cache-only |
| execution_attempts | attempt_id, execution_id, ordinal, owner, generation, coord_epoch, attempt status + four dimensions | Unique execution+ordinal; generation checks on mutation |
| model_invocations | invocation_id, attempt_id, upstream refs, model/provider, dispatch/outcome, usage coverage | Every actual paid call attributable |
| tool_operations | operation_id, logical key, digest, target, state, receipt/status refs | Stable receiver idempotency key; old attempt evidence not owner |
| operation_invocations | invocation_id, operation_id, attempt_id, dispatched/received times | Retry references same logical operation |
| cancel_intents | execution_id, request actor/time/reason, revision | Durable idempotent command |
| control_events | event_id, execution_id, revision, type, sanitized payload/ref | Durable state/audit events only, no model.delta |
| outbox / inbox | event/command ID, aggregate/revision, delivery state | At-least-once dispatch, unique consumption key |
| budget_accounts | scope/period/currency, limit, posted_charge, held, revision | Transactional correctness authority |
| reservations | reservation_id, execution_id, account scopes, amount, residual_hold, state, revision | Durable before dispatch; no TTL-only financial release |
| usage_observations | source/event/revision, invocation ref, units, cost basis, completeness, verification, evidence | Append evidence; conflicting duplicate quarantined |
| ledger_entries | ledger_id, account, charge/adjustment amount, currency, evidence IDs, previous-entry ref | Append-only economic entries; posting command unique |
| artifacts/manifests | artifact_id, tenant/app, object ref/digest/size, producer attempt, state/retention | Official result pointer only by fenced finalization |
| runtime_sessions | session_id, scope, runtime/profile versions, revision, active writer, checkpoint | Single writer; same-runtime/version policy |
| coordination_state | environment/pool epoch, status, last authorized transition | Serializes rebuild/failover bootstrap |

## 2. Transaction boundaries

Admission groups idempotency claim, execution, reservation/account hold, and outbox. Assignment groups attempt/generation/current-pointer and control event. Mutation-tool intent is durable before remote dispatch. Result finalization groups authoritative result pointer/status/revision/control event. Settlement groups accepted charge/adjustment, reservation/account update, and projection outbox.

These boundaries intentionally avoid pretending PostgreSQL, Redis, object store, and external provider share a distributed transaction. Compensation/reconciliation handles incomplete boundaries with stable operation IDs.

## 3. Uniqueness dan indexes

Candidate unique keys: idempotency scope+key, execution+attempt ordinal, logical tool key within authorized scope, source observation identity/revision, settlement command ID, inbox consumer+event ID. Provider request ID alone is insufficient where account/source namespaces overlap or observation revisions exist.

Candidate access indexes: tenant/app+created_at+execution_id; tenant/app+process+step; active attempt status+assigned_at; pending reconciliation age; undelivered outbox; artifact expiry; reservation account+state; usage scope+occurred_at. Final physical indexes/partitioning ditentukan dari EXPLAIN/workload tests, bukan membuat semua JSON fields terindex sejak awal.

## 4. Write paths dan contention

Heartbeat/delta tidak menghasilkan periodic row writes. Admission/settlement locks budget account rows pada urutan stabil; bounded transactions dan retry-on-serialization-conflict. Hot account contention dipantau; sharded allocations boleh menjadi future ADR hanya jika conservation invariant terbukti.

No DB connection held while waiting model stream, sandbox runtime, or upstream tool call. Poll/scan menggunakan bounded batches dan backoff. Outbox retention/cleanup tidak menghapus event yang masih diperlukan recovery.

## 5. Redis keys konseptual

Lease: scoped coordination epoch/execution/attempt -> exact owner/generation/nonce TTL. Stream: execution/attempt/epoch -> ordered bounded event buffer. Cache: account -> absolute balance projection + revision. Rate window: authorized app/profile/workload scope. Key names tidak memuat secrets/raw prompts.

Redis expiry tidak menghapus authoritative attempts/reservations atau memfinalisasi charge. Stream truncation mengubah earliest cursor; worker lease reset memerlukan coordinator protocol. Persistence/replication configuration merupakan deployment decision, bukan semantik finansial.

## 6. Retention, encryption, dan deletion

Minimalkan payload dalam relational records; encrypted object refs untuk artifacts/evidence yang sensitif. Retention owner menentukan data classes: usage accounting metadata, security audit, raw prompts, model outputs, quarantine, session checkpoints, and backups. Tidak menetapkan permanen untuk semua data hanya karena tabel bernama audit.

Deletion harus mempertahankan minimal financial trace sesuai kebijakan yang disetujui tanpa menyimpan prompt berlebihan. Record tombstone/hold exception/audit actor. Restore backup harus mengikuti deletion replay dan stale-worker fencing, bukan menghidupkan ulang abandoned attempts.

## 7. Migration strategy

Expand-contract schema changes; additive columns/event versions before reader upgrade; backfill dengan rate limit; validate invariant; drop deprecated fields setelah consumers migrated. Never rewrite ledger history untuk mengubah source basis; append corrections. Dry-run restore, idempotent replay, and mixed-version tests diperlukan sebelum production migration.

ERD dan trust-zone view: [data/deployment diagrams](../diagrams/07-deployment-data-security.md).
