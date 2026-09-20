# Execution Profiles dan Adapter Contracts

**Baseline 0.2.** Managed Execution Envelope menjaga common lifecycle; cognitive harness tetap dimiliki app/team. Profil diterjemahkan dan diuji, bukan dijanjikan universal.

## 1. Konsep yang tidak boleh dicampur

| Konsep | Contoh ilustratif | Fungsi |
| --- | --- | --- |
| Capability | chat, structured_generate, agent_execute | Kebutuhan execution |
| Provider adapter | openrouter, direct-anthropic | Integrasi API inference |
| Runtime adapter | claude, codex, gemini | Agent lifecycle/tools/workspace/session |
| Model policy | approved-document-models | Model allowlist/capability/context/data policy |
| Credential binding | org-api-key-binding | Secret reference dan allowed upstream identity |
| Cognitive harness | scribe-package@digest | App-owned instructions/templates/domain tools |
| Execution profile | scribe-document@2 | Versi gabungan policy dan compatible bindings |

Tidak semua runtime dapat memakai semua provider/binding. Model yang sama melalui aggregator bukan berarti menjalankan agent CLI vendor. Compatibility disimpan sebagai tested tuple, bukan Cartesian product otomatis.

## 2. Profile schema konseptual

```json
{
  "profile": "scribe-document@2",
  "capability": "agent_execute",
  "runtime": {"adapter": "claude", "version_policy": "approved-pinned-version"},
  "model_policy_ref": "document-models@1",
  "credential_binding_ref": "scribe-runtime-key@1",
  "harness_ref": "scribe-package@sha256:example",
  "tool_policy_ref": "scribe-artifact-only@1",
  "data_policy_ref": "internal-documents@1",
  "limits": {"max_attempts": 2, "max_turns": 15, "max_concurrency": 2},
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

| Operation | Input/output | Obligasi |
| --- | --- | --- |
| describeCapabilities | Versioned capability set | Tidak mengiklankan fitur yang belum dibuktikan |
| validateAndPrepare | Normalized request + resolved policy -> provider request | Unsupported parameter explicit error, no silent drop |
| invoke/stream | Attempt/invocation context -> normalized response/events | Capture request ID, resolved model, finish reason, usage scope |
| cancel | Request handle -> cancellation evidence | Bedakan request accepted, upstream confirmed, unknown |
| reconcileUsage | Upstream ID -> evidence bila didukung | Tidak mengarang usage jika provider tidak menyediakan lookup |
| normalizeError | Provider error -> platform category | Preserve sanitized debug refs tanpa secret |

Adapter tidak mengubah business job, tidak melakukan hidden unbounded retry, dan tidak menyimpan usage lewat jalur terpisah yang menghindari dedup. Setiap actual invocation dicatat.

## 5. Runtime adapter interface konseptual

prepare(profile snapshot, workspace, scoped grants); start(attempt); streamEvents(); cancel(reason); inspectLocalExecution(); collectResultManifest(); collectUsageEvidence(); optional resume(session revision).

Runtime harus mengungkap tool/approval/session support dan batas enforcement. Sumber programatis resmi tersedia untuk Codex SDK dan headless Gemini (R01/R05 di [SOURCES](../reviews/SOURCES.md)); pilihan versi dan detail integrasi masih harus diverifikasi saat implementasi. Claude SDK usage dapat berupa estimate, bukan authoritative billing (R04). Baseline tidak mengasumsikan semua runtime memberikan per-invocation detail.

## 6. Planned compatibility matrix

Legenda: PLANNED berarti requirement yang akan diuji; CONDITIONAL berarti support hanya setelah profile/runtime specific proof; DEFERRED bukan fitur MVP.

| Jalur | Chat/structured | Tools/workspace | Resume | Detailed usage | Status |
| --- | --- | --- | --- | --- | --- |
| OpenRouter gateway | PLANNED; supported model/provider only | Caller-controlled tool-call output bila enabled, tanpa autonomous sandbox | App conversation, bukan agent session | Provider evidence sesuai source capability | P2 |
| Direct Anthropic gateway | PLANNED; model constraints apply | Sama batas gateway | App conversation | Provider-specific mapping | P2 proof |
| Claude runtime | Agent workload | CONDITIONAL approved sandbox/tools | CONDITIONAL same runtime/version | Observed summary atau invocation sesuai adapter | P3 |
| Codex runtime | Agent workload | CONDITIONAL | CONDITIONAL | Must map/test | P5 |
| Gemini runtime | Agent workload | CONDITIONAL | CONDITIONAL | Must map/test | P6 |
| Embedding/rerank/audio | DEFERRED | Tidak dipaksakan menjadi chat | Not assumed | Capability-specific units | P7 |

## 7. Routing dan fallback

Filter eligible routes berdasarkan identity, profile capability, model/schema, data residency/retention, credential, health, dan budget. Pilih primary per profile; OpenRouter boleh primary. Runtime selection berbeda dari provider selection; jangan fallback dari agent ke direct API dan berpura-pura semantics sama.

Direct Anthropic membuktikan adapter kedua pada P2, tidak otomatis menjadi primary produksi. Common contract suite mencakup successful response, errors, stream cancellation, schema rejection, and usage normalization. Operational failover suite terpisah.

Safe fallback diperbolehkan sebelum side effect/output yang mengikat, dengan attempt log dan reservation yang cukup. Ambiguous upstream acceptance perlu reconciliation/risk policy; retry masih dapat menambah biaya. Jangan campurkan partial outputs dari dua routes sebagai satu final result.

OpenRouter routing dapat dikonfigurasi untuk parameter support dan ZDR (R02/R03 di SOURCES). Platform tetap memverifikasi constraints rute/plugin; tidak menyatakan blanket compliance dari nama provider. Health cache dan circuit breaker tidak menggantikan durable admission.

## 8. Upgrade contract

Pin adapter/runtime/package versions. Upgrade candidate mengulang contract, sandbox, usage, resume, dan quality tests pada affected profiles. Canary alias sebelum broader rollout. Rollback ke version lama hanya untuk new attempts; jangan resume incompatible checkpoint. Store approved version history agar audit dapat menjelaskan model/runtime/profile yang benar-benar dipakai.
