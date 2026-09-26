# Logical Data Model dan Persistence Contracts

**Physical implementation reconciled 25 September 2026; target logical model retained separately.** Money semantics ada di [ACCOUNTING](ACCOUNTING.md), state enum di [LIFECYCLE](../contracts/EXECUTION-LIFECYCLE.md).

## Physical models yang sudah ada

Tabel berikut berasal dari [Prisma schema](../../prisma/schema.prisma), bukan dari nama konseptual pada baseline. Migration SQL [0001](../../prisma/migrations/0001_baseline/migration.sql)–[0010](../../prisma/migrations/0010_m2_invocation_route/migration.sql) memuat DDL dan custom constraints untuk M0, M1, runner authority, dan local M2 gateway. LegacySchemaMigration adalah provenance read-only, bukan feature execution.

| Prisma model            | Physical table                   |
| ----------------------- | -------------------------------- |
| `Application`           | `m0.applications`                |
| `Profile`               | `m0.profiles`                    |
| `ContractCheck`         | `m0.contract_checks`             |
| `LegacySchemaMigration` | `m0.schema_migrations`           |
| `ControlApplication`    | `control.applications`           |
| `AiConnection`          | `control.ai_connections`         |
| `CredentialInstance`    | `control.credential_instances`   |
| `CredentialBinding`     | `control.credential_bindings`    |
| `ProfileRevision`       | `control.profile_revisions`      |
| `ProfileAlias`          | `control.profile_aliases`        |
| `BudgetAccount`         | `control.budget_accounts`        |
| `Execution`             | `control.executions`             |
| `Attempt`               | `control.attempts`               |
| `ExecutionResult`       | `control.execution_results`      |
| `ProviderInvocation`    | `control.provider_invocations`   |
| `Reservation`           | `control.reservations`           |
| `UsageObservation`      | `control.usage_observations`     |
| `LedgerEntry`           | `control.ledger_entries`         |
| `OutboxEvent`           | `control.outbox_events`          |
| `InboxReceipt`          | `control.inbox_receipts`         |
| `BudgetProjection`      | `control.budget_projections`     |
| `AuditEntry`            | `control.audit_entries`          |
| `ArtifactMetadata`      | `control.artifact_metadata`      |
| `RunnerPool`            | `control.runner_pools`           |
| `RunnerNode`            | `control.runner_nodes`           |
| `AdmissionRateWindow`   | `control.admission_rate_windows` |
| `ManagementReceipt`     | `control.management_receipts`    |
| `RunnerAssignment`      | `control.runner_assignments`     |
| `RunnerEvidence`        | `control.runner_evidence`        |

M0 idempotency berada pada ContractCheck; M1 admission key/digest berada pada Execution, bukan tabel idempotency_records generik. Cancel intent disimpan sebagai timestamp pada Execution dan outbox event, bukan cancel_intents terpisah. ProfileAlias.version untuk concurrency berbeda dari revision profile yang dipilih. ManagementReceipt menyimpan caller-scoped key, digest dan historical response atomik dengan mutation/audit; deferred trigger mencegah incomplete commit. Window replay tujuh hari tidak otomatis menghapus record/key.

RunnerAssignment memuat exact ownership/generation/epoch, proposal dan status. RunnerEvidence memuat intake yang selalu QUARANTINED pada endpoint sekarang; tidak otomatis menjadi UsageObservation atau LedgerEntry. Execution menyimpan assignmentGeneration dan coordinationEpoch. ProviderInvocation dan ExecutionResult sudah physical pada M2, termasuk connection attribution. Tool operation, runtime session, plugin package, object manifest dan global coordination recovery tables dari model target belum tersedia.

Financial units memakai BigInt di database dan decimal string pada wire. DateTime diproyeksikan ke ISO string; current query keyset berbeda antarpermukaan sebagaimana [HTTP API](../implementation/HTTP-API.md). AuditEntry tidak mempunyai prompt atau generic payload; OutboxEvent mempunyai JSON payload, tetapi resource list baru mengecualikannya pada select. Batas page bytes tidak menggantikan batas item/field dan capacity testing.

Bagian bernomor berikut adalah model target dan migration requirements, bukan daftar tabel yang semuanya telah terpasang.

## 1. Target logical entity catalogue

| Entity                | Identity/important fields                                                                                                           | Constraints / owner                                             |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| applications          | app_id, Keycloak client mapping, service principal/client binding, environment, status                                              | Identity policy service; no raw secret                          |
| execution_profiles    | profile_id, revision, content digest, policy refs, state                                                                            | Immutable published revision                                    |
| executions            | execution_id, application, optional process/step/conversation, profile revision, public status/revision, current attempt/generation | Scoped reads; monotonic durable revision                        |
| idempotency_records   | application/family/key, request digest, execution_id, expiry/tombstone                                                              | Unique scope+key; never cache-only                              |
| execution_attempts    | attempt_id, execution_id, ordinal, owner, generation, coord_epoch, attempt status + four dimensions                                 | Unique execution+ordinal; generation checks on mutation         |
| model_invocations     | invocation_id, attempt_id, upstream refs, model/provider, dispatch/outcome, usage coverage                                          | Every actual paid call attributable                             |
| tool_operations       | operation_id, logical key, digest, target, state, receipt/status refs                                                               | Stable receiver idempotency key; old attempt evidence not owner |
| operation_invocations | invocation_id, operation_id, attempt_id, dispatched/received times                                                                  | Retry references same logical operation                         |
| cancel_intents        | execution_id, request actor/time/reason, revision                                                                                   | Durable idempotent command                                      |
| control_events        | event_id, execution_id, revision, type, sanitized payload/ref                                                                       | Durable state/audit events only, no model.delta                 |
| outbox / inbox        | event/command ID, aggregate/revision, delivery state                                                                                | At-least-once dispatch, unique consumption key                  |
| budget_accounts       | scope/period/currency, limit, posted_charge, held, revision                                                                         | Transactional correctness authority                             |
| reservations          | reservation_id, execution_id, account scopes, amount, residual_hold, state, revision                                                | Durable before dispatch; no TTL-only financial release          |
| usage_observations    | source/event/revision, invocation ref, units, cost basis, completeness, verification, evidence                                      | Append evidence; conflicting duplicate quarantined              |
| ledger_entries        | ledger_id, account, charge/adjustment amount, currency, evidence IDs, previous-entry ref                                            | Append-only economic entries; posting command unique            |
| artifacts/manifests   | artifact_id, application, object ref/digest/size, producer attempt, state/retention                                                 | Official result pointer only by fenced finalization             |
| runtime_sessions      | session_id, scope, runtime/profile versions, revision, active writer, checkpoint                                                    | Single writer; same-runtime/version policy                      |
| coordination_state    | environment/pool epoch, status, last authorized transition                                                                          | Serializes rebuild/failover bootstrap                           |

## 2. Transaction boundaries

Admission groups idempotency claim, execution, reservation/account hold, and outbox. Assignment groups attempt/generation/current-pointer and control event. Mutation-tool intent is durable before remote dispatch. Result finalization groups authoritative result pointer/status/revision/control event. Settlement groups accepted charge/adjustment, reservation/account update, and projection outbox.

These boundaries intentionally avoid pretending PostgreSQL, Redis, object store, and external provider share a distributed transaction. Compensation/reconciliation handles incomplete boundaries with stable operation IDs.

## 3. Uniqueness dan indexes

Candidate unique keys: idempotency scope+key, execution+attempt ordinal, logical tool key within authorized scope, source observation identity/revision, settlement command ID, inbox consumer+event ID. Provider request ID alone is insufficient where account/source namespaces overlap or observation revisions exist.

Candidate access indexes: application+created_at+execution_id; application+process+step; active attempt status+assigned_at; pending reconciliation age; undelivered outbox; artifact expiry; reservation account+state; usage scope+occurred_at. Final physical indexes/partitioning ditentukan dari EXPLAIN/workload tests, bukan membuat semua JSON fields terindex sejak awal.

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

## 8. Registry dan fleet entities

Durable control-plane model menambahkan logical entities: `applications`, `ai_connections`, `credential_instances`, `credential_bindings`, `plugin_packages`, `plugin_versions`, `runner_pools`, `runner_nodes`, `runner_capabilities`, `connection_runner_bindings`, dan profile bindings.

Credential row hanya menyimpan metadata/reference; plaintext secret bukan durable application data. `ai_connection` merepresentasikan logical upstream account/project. Banyak credential instance/runner binding dapat menunjuk connection yang sama. `quota_group_ref` mengelompokkan bindings yang berbagi upstream rate-limit/budget authority.

Runner liveness dan instantaneous capacity tidak ditulis heartbeat-per-second ke PostgreSQL; Redis/hot tier memegang lease/capacity. PostgreSQL menyimpan durable registration state, lifecycle intent seperti DRAIN/DISABLE, capability snapshots yang perlu audit, dan assignment authority transitions.
