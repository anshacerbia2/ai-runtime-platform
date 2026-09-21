# Application Adoption dan Migration Playbook

**Target design, bukan laporan perubahan pada repo aplikasi.** Berdasarkan kebutuhan dan project patterns dalam percakapan. Source code aplikasi tidak diubah oleh task dokumentasi ini.

## 1. Common integration seam

App keeps job/workflow -> calls platform client with profile + typed input + optional process/step -> receives execution ID/result/events -> validates business output -> decides next step. Platform credential replaces provider-specific integration at this seam; business schema/validation remains app-owned.

Track old path and new path separately during migration. Business operation idempotency survives switching paths; never invoke both publish paths as shadow. Missing usage from old system remains labeled unknown, not backfilled with zero.

## 2. Per-application target

| Consumer          | Target change                                                                       | Preserve                                                       | Acceptance                                                           |
| ----------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------- |
| Scribe BE         | Delegate AI execution/profile/artifact handling to runtime API                      | Job states, queue bisnis, validation/review, Drive publication | Same document quality, result manifest, failure/cancel semantics     |
| Scribe UI         | Continue through BE; display execution progress/status and pending usage accurately | User/business workflow                                         | Reconnect without duplicate job or lost final result                 |
| Scribe plugin     | Package immutable harness/scripts/schema with per-runtime manifest                  | Domain knowledge/templates                                     | Claude conformance first; Codex/Gemini only after explicit tests     |
| Claude runner     | Extract adapter + supervisor boundary, remove caller-controlled unsafe config       | Useful runtime integration                                     | Isolation, generation, cancellation, usage/late evidence tests       |
| Themis/sq-fare    | Replace narrow inference provider seam                                              | Fare rules/schema/domain evidence                              | Golden outputs, schema rejection, no silent model enum drift         |
| Farexlate         | Map translate/verify/repair step calls to gateway                                   | Glossary/TM/batch logic/QA/rendering                           | Per-stage quality/cost including repair attempts                     |
| RAGnosis/ragnarok | Route selected generation/vision model calls                                        | Retrieval/ACL/query/citation logic                             | Citation/evidence correctness, access isolation, interactive latency |
| New chat app      | Start with gateway profile, optional conversation ID                                | App-owned history/UI/consent                                   | No fake job/plugin; streaming, cancel and usage correctness          |

Embedding/rerank migration is separate capability work. Changing embedding model/index is not an incidental provider switch; app owner handles index version/retrieval validation and rollback.

## 3. Rollout steps

Inventory current invocation surfaces, credentials, output schemas, side effects, quality fixtures, costs/unknowns, and fallback behavior. Register app identity/profile/harness with explicit data policy. Implement client adapter at narrow seam in future implementation work.

Run nonproduction contract tests with representative fixtures. Compare normalized output and business acceptance—not only HTTP success. Establish measured latency/total cost per accepted output with failed attempts included. Shadow inference only with approved data/budget; never duplicate stateful actions.

Pass applicable P3.5 gate, then canary a bounded cohort selected by app. Monitor duplicate requests, unknown usage, replay gaps, cancellations, queue latency, quality rejection, and external ambiguity. Roll back new admissions to old path if acceptance thresholds fail; reconcile existing executions instead of re-running blindly.

## 4. Reversibility

Maintain mapping business job/step -> platform execution/attempt and stable operation keys. Rollback must not reset keys or lose holds. Existing runtime sessions remain on compatible version/path until closed or explicitly restarted. Decommission old credential/integration only after quality/cost/recovery evidence and known outstanding operations resolved.

## 5. Ownership and definition of migrated

App owner approves domain correctness and workflow boundary. Platform owner approves operational evidence. Security approves data/credential scope. Accounting owner approves attribution/unknown treatment. Migrated means consumers use shared contract for intended calls and rollback is tested; it does not mean all domain logic or jobs moved to platform.

Flow: [migration/evolution](../diagrams/08-evolution-migration.md). Plan phase P4 is gated; no production app changes are performed by this documentation update.

## Registry onboarding checklist

Sebelum app cutover, buat Application Registry entry dan mapping Keycloak, publish allowed profile revisions, bind AI Connections secara explicit, tetapkan budget/data policy, dan register plugin/remote-tool dependencies hanya bila workload membutuhkannya. App tidak membawa provider secret atau runner address ke execution request.

Untuk app dengan dedicated provider account, connection binding harus membuktikan cross-app denial. Untuk shared account, quota group dan ownership/chargeback harus jelas. Jika workload memakai app-owned MCP/remote API, receiver idempotency/status contract diuji sebelum mutating tool diaktifkan.
