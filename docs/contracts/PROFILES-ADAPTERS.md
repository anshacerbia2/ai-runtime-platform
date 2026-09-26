# Execution Profiles dan Adapter Contracts

**Baseline 0.2.** Managed Execution Envelope menjaga common lifecycle; cognitive harness tetap dimiliki app/team. Profil diterjemahkan dan diuji, bukan dijanjikan universal.

## Implementasi profile yang tersedia

M0 demo Profile berlabel contract-only dan dipakai validasi. M1/M2 ProfileRevision menyimpan immutable application/profile revision, primary connection/provider/model, optional explicit fallback connection/provider/model, capability, holdUnits/accountIds, gateway limits dan digest; ProfileAlias menyimpan selected revision, enabled dan concurrency version. Publication/repoint alias tersedia pada resource API dengan receipt. Gateway invoke/stream/fallback lokal sudah diimplementasikan; plugin packaging dan per-runtime agent/session compatibility tetap target M3+.

Sumber: [Prisma models](../../prisma/schema.prisma), [command schemas](../../packages/contracts/src/control-plane.ts), [resource contract](../../packages/contracts/src/http/resources.ts), [gateway contract](../../packages/contracts/src/http/gateway.ts), [current state](../implementation/CURRENT-STATE.md). `chat`, `generate`, dan `structured_generate` sudah local-implemented; `agent_execute` tetap contract-only.

## 1. Konsep yang tidak boleh dicampur

| Konsep             | Contoh ilustratif                                          | Fungsi                                                                    |
| ------------------ | ---------------------------------------------------------- | ------------------------------------------------------------------------- |
| Capability         | `chat`, `generate`, `structured_generate`, `agent_execute` | Kebutuhan execution; canonical catalogue: [CAPABILITIES](CAPABILITIES.md) |
| Provider adapter   | openrouter, direct-anthropic                               | Integrasi API inference                                                   |
| Runtime adapter    | claude, codex, gemini                                      | Agent lifecycle/tools/workspace/session                                   |
| Model policy       | approved-document-models                                   | Model allowlist/capability/context/data policy                            |
| Credential binding | org-api-key-binding                                        | Secret reference dan allowed upstream identity                            |
| Cognitive harness  | scribe-package@digest                                      | App-owned instructions/templates/domain tools                             |
| Execution profile  | scribe-document@2                                          | Versi gabungan policy dan compatible bindings                             |

Tidak semua runtime dapat memakai semua provider/binding. Model yang sama melalui aggregator bukan berarti menjalankan agent CLI vendor. Compatibility disimpan sebagai tested tuple, bukan Cartesian product otomatis.

## 2. Profile schema konseptual

```json
{
  "profile": "scribe-document@2",
  "capability": "agent_execute",
  "runtime": {
    "adapter": "claude",
    "version_policy": "approved-pinned-version"
  },
  "model_policy_ref": "document-models@1",
  "credential_binding_ref": "scribe-runtime-key@1",
  "harness_ref": "scribe-package@sha256:example",
  "tool_policy_ref": "scribe-artifact-only@1",
  "data_policy_ref": "internal-documents@1",
  "limits": { "max_attempts": 2, "max_turns": 15, "max_concurrency": 2 },
  "budget_policy_ref": "scribe-budget@1",
  "session_policy": "same-runtime-single-writer",
  "workload_class": "agent"
}
```

Nilai limit dan digest di atas contoh, bukan production approval. Limits lengkap harus menyatakan input/output per invocation, aggregate turn/attempt cap, duration, process/memory/filesystem/network quotas, tool timeout, serta financial exposure strategy. Profile tidak valid bila requirement tidak dapat ditegakkan adapter.

Chat profile tidak memiliki harness/plugin atau agent sandbox. Alias profile mutable untuk rollout; execution menyimpan resolved immutable revision dan dependency digests. Replayed idempotent request tetap memakai snapshot awal.

## 3. Publication lifecycle

DRAFT -> VALIDATED -> APPROVED -> ACTIVE -> DEPRECATED -> RETIRED. Perubahan content/profile membuat revision baru. App owner menyetujui domain harness; platform/security menyetujui permissions; adapter tests membuktikan capability. Expanding privilege memerlukan review, bukan edit alias diam-diam.

Server memvalidasi supported tuple, output schema, allowed egress, credential scope, data restrictions, budget strategy, tool idempotency, dan relevant quality fixture. Production profile hanya ACTIVE setelah gate. Retirement menolak new execution; existing attempts mengikuti snapshot dengan kill switch security tetap dapat override secara auditable.

## 4. Provider adapter interface konseptual

| Operation            | Input/output                                             | Obligasi                                                       |
| -------------------- | -------------------------------------------------------- | -------------------------------------------------------------- |
| describeCapabilities | Versioned capability set                                 | Tidak mengiklankan fitur yang belum dibuktikan                 |
| validateAndPrepare   | Normalized request + resolved policy -> provider request | Unsupported parameter explicit error, no silent drop           |
| invoke/stream        | Attempt/invocation context -> normalized response/events | Capture request ID, resolved model, finish reason, usage scope |
| cancel               | Request handle -> cancellation evidence                  | Bedakan request accepted, upstream confirmed, unknown          |
| reconcileUsage       | Upstream ID -> evidence bila didukung                    | Tidak mengarang usage jika provider tidak menyediakan lookup   |
| normalizeError       | Provider error -> platform category                      | Preserve sanitized debug refs tanpa secret                     |

Adapter tidak mengubah business job, tidak melakukan hidden unbounded retry, dan tidak menyimpan usage lewat jalur terpisah yang menghindari dedup. Setiap actual invocation dicatat.

## 5. Runtime adapter interface konseptual

prepare(profile snapshot, workspace, scoped grants); start(attempt); streamEvents(); cancel(reason); inspectLocalExecution(); collectResultManifest(); collectUsageEvidence(); optional resume(session revision).

Runtime harus mengungkap tool/approval/session support dan batas enforcement. Sumber programatis resmi tersedia untuk Codex SDK dan headless Gemini (R01/R05 di [SOURCES](../reviews/SOURCES.md)); pilihan versi dan detail integrasi masih harus diverifikasi saat implementasi. Claude SDK usage dapat berupa estimate, bukan authoritative billing (R04). Baseline tidak mengasumsikan semua runtime memberikan per-invocation detail.

## 6. Compatibility matrix

Legenda: LOCAL berarti adapter/path tersedia dan lulus local conformance/integration tests; CONDITIONAL berarti support hanya setelah profile/runtime specific proof; DEFERRED bukan fitur MVP. LOCAL bukan production deployment approval.

| Jalur                    | Chat/structured                        | Tools/workspace                                                           | Resume                                | Detailed usage                                  | Status   |
| ------------------------ | -------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------- | ----------------------------------------------- | -------- |
| OpenRouter gateway       | LOCAL; chat/generate/structured + SSE  | No autonomous sandbox/tools in M2                                         | Event replay by execution             | Provider-reported usage normalized              | P2 local |
| Direct Anthropic gateway | LOCAL dual-adapter proof               | No autonomous sandbox/tools in M2                                         | Event replay by execution             | Provider-specific cumulative usage mapping      | P2 local |
| Claude runtime           | Agent workload                         | CONDITIONAL approved sandbox/tools                                        | CONDITIONAL same runtime/version      | Observed summary atau invocation sesuai adapter | P3       |
| Codex runtime            | Agent workload                         | CONDITIONAL                                                               | CONDITIONAL                           | Must map/test                                   | P5       |
| Gemini runtime           | Agent workload                         | CONDITIONAL                                                               | CONDITIONAL                           | Must map/test                                   | P6       |
| Embedding/rerank/audio   | DEFERRED                               | Tidak dipaksakan menjadi chat                                             | Not assumed                           | Capability-specific units                       | P7       |

## 7. Routing dan fallback

Filter eligible routes berdasarkan identity, profile capability, model/schema, data residency/retention, credential, health, dan budget. Pilih primary per profile; OpenRouter boleh primary. Runtime selection berbeda dari provider selection; jangan fallback dari agent ke direct API dan berpura-pura semantics sama.

Direct Anthropic membuktikan adapter kedua pada P2, tidak otomatis menjadi primary produksi. Common contract suite mencakup successful response, errors, stream cancellation, schema rejection, and usage normalization. Operational failover suite terpisah.

Implementasi M2 mengizinkan satu fallback yang eksplisit di immutable profile revision hanya ketika primary menghasilkan outcome `not-sent` sebelum provider-start/output/usage evidence. Fallback membuat durable attempt/invocation baru tanpa membuat admission/reservation kedua. Ambiguous acceptance atau partial output masuk reconciliation dan tidak pernah di-splice dengan route lain. Fallback shared-connection belum diaktifkan; alternate route saat ini harus dedicated sampai quota semantics lintas-route dibuktikan.

OpenRouter routing dapat dikonfigurasi untuk parameter support dan ZDR (R02/R03 di SOURCES). Platform tetap memverifikasi constraints rute/plugin; tidak menyatakan blanket compliance dari nama provider. Health cache dan circuit breaker tidak menggantikan durable admission.

## 8. Upgrade contract

Pin adapter/runtime/package versions. Upgrade candidate mengulang contract, sandbox, usage, resume, dan quality tests pada affected profiles. Canary alias sebelum broader rollout. Rollback ke version lama hanya untuk new attempts; jangan resume incompatible checkpoint. Store approved version history agar audit dapat menjelaskan model/runtime/profile yang benar-benar dipakai.

## 9. Application, connection, plugin, dan placement bindings

Execution Profile adalah server-managed policy snapshot. Selain capability/runtime/model/limits, profile dapat mengikat `connection_policy_ref`, optional `plugin_ref`, `tool_policy_ref`, `workspace_policy`, `runner_pool_ref`, `data_policy_ref`, dan `budget_policy_ref`.

Caller tidak mengirim provider secret, credential instance, runner ID, local plugin path, atau host filesystem path. Resolution order konseptual:

`authenticated application -> profile revision -> allowed AI connections -> eligible credential instances -> eligible runner pool/nodes -> adapter/runtime`

Connection selection dan placement harus fail closed jika tidak ada candidate yang memenuhi seluruh policy. Profile portability tidak menjanjikan plugin/runtime interchangeability; compatibility dipublikasikan per revision.
