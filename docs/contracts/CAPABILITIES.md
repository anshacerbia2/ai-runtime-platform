# Capability Catalogue

Dokumen ini adalah **canonical catalogue** untuk capability AI Runtime Platform. Ia menjawab capability apa yang dikenal platform, execution path-nya, feature yang boleh dipasang di atasnya, status implementasi, dan bukti yang dibutuhkan sebelum production.

Capability adalah kebutuhan execution yang diminta application/profile. Capability **bukan** nama vendor, model, runtime, plugin, AI Connection, atau runner.

## Checkpoint implementasi 25 September 2026

Registry, durable admission/accounting, manual runner authority, dan gateway M2 sudah ada. `chat`, `generate`, dan `structured_generate` dapat dieksekusi melalui local gateway dengan OpenRouter/Direct Anthropic adapters, bounded SSE/replay, dan durable result/usage. `agent_execute` tetap CONTRACT_ONLY sampai M3 runtime tersedia. Demo M0 tetap contract-only dan tidak memanggil provider. [Current source](../implementation/CURRENT-STATE.md) dan [HTTP catalogue](../implementation/HTTP-API.md) adalah rujukan ketersediaan operasi.

## 1. Status vocabulary

| Status                 | Arti                                                                          |
| ---------------------- | ----------------------------------------------------------------------------- |
| `CONTRACT_ONLY`        | Schema/contract tersedia; belum ada live execution                            |
| `PLANNED`              | Disetujui untuk milestone tertentu; implementation belum tersedia             |
| `IMPLEMENTED_NONPROD`  | Jalur runtime tersedia tetapi belum melewati production gate                  |
| `VERIFIED_FOR_PROFILE` | Capability + adapter/runtime/profile tertentu telah melewati applicable gates |
| `DEFERRED`             | Kandidat future; public enum/contract belum dijanjikan                        |

Status selalu scoped. `chat` dapat verified pada satu profile/provider tetapi tetap belum verified pada route lain.

## 2. Canonical v1 capability IDs

| Capability            | Primary execution path | Typical input                            | Result                                         | Streaming                 | Plugin/workspace                          | Target milestone | Current status      |
| --------------------- | ---------------------- | ---------------------------------------- | ---------------------------------------------- | ------------------------- | ----------------------------------------- | ---------------- | ------------------- |
| `chat`                | Model Gateway          | ordered messages/content                 | text                                           | yes if profile allows     | not required                              | M2               | IMPLEMENTED_NONPROD |
| `generate`            | Model Gateway          | prompt/input                             | text                                           | optional/profile          | not required                              | M2               | IMPLEMENTED_NONPROD |
| `structured_generate` | Model Gateway          | prompt + bounded response schema         | validated structured value or explicit failure | optional/profile          | not required                              | M2               | IMPLEMENTED_NONPROD |
| `agent_execute`       | Agent Runtime          | task/prompt + optional context/artifacts | text/structured/artifacts/mixed                | profile/runtime dependent | optional plugin; optional workspace/tools | M3               | CONTRACT_ONLY       |

Empat ID di atas adalah public capability enum baseline v1. M0 hanya memvalidasi kontraknya dan **tidak** menjalankan AI provider/runtime.

## 3. Orthogonal execution features

Feature berikut tidak boleh dibuat capability baru bila hanya mengubah cara capability dieksekusi:

| Feature               | Semantics                                                                                                         |
| --------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Streaming             | Delivery mode; bounded replay/cursor policy berlaku bila enabled                                                  |
| Structured output     | Native untuk `structured_generate`; dapat menjadi runtime/tool detail pada agent tanpa mengubah public capability |
| Plugin/harness        | Versioned execution package; optional dan profile-bound                                                           |
| Workspace             | `none`, `ephemeral`, atau `artifact_workspace`; optional per profile                                              |
| Tools                 | Platform-owned, packaged-plugin, atau remote tool; permission profile-bound                                       |
| MCP                   | Salah satu remote-tool transport; **bukan capability dan bukan mandatory**                                        |
| Artifact input/output | Logical refs + promotion contract; tidak mengekspos host path                                                     |
| Runtime session       | Optional same-runtime continuity; bukan business conversation ownership                                           |
| AI Connection         | Credential/routing binding; bukan capability                                                                      |
| Runner placement      | Execution location; bukan capability                                                                              |

Karena dimensi ini orthogonal, direct `chat` dapat stateless tanpa workspace/plugin, sedangkan `agent_execute` dapat memakai plugin + artifact workspace + remote tools pada profile tertentu.

## 4. Capability descriptor contract

Setiap capability yang dipublish harus mempunyai descriptor/versioned metadata minimal:

- `capability_id` dan schema/version;
- allowed execution path (`gateway` atau `agent`);
- request/input schema dan result kinds;
- streaming semantics;
- tool/plugin/workspace/session compatibility;
- artifact/media types yang didukung;
- limits yang dapat ditegakkan (tokens, duration, turns, concurrency, payload);
- accounting/usage unit dan completeness expectations;
- compatible provider/runtime adapter revisions;
- data/credential policy requirements;
- current lifecycle status dan evidence scope.

`GET /v1/capabilities` nantinya mengembalikan **caller-scoped** descriptors/profiles, bukan seluruh kemampuan internal platform.

## 5. Adapter/runtime support is a matrix

Capability tidak dianggap didukung hanya karena vendor memiliki fitur serupa. Support harus dibuktikan pada kombinasi capability + adapter/runtime + profile revision.

Contoh target M2: `chat`, `generate`, dan `structured_generate` dibuktikan pada OpenRouterAdapter dan DirectAnthropicAdapter sejauh fitur upstream benar-benar kompatibel. Target M3: `agent_execute` dibuktikan pertama pada Claude runtime. Codex/Gemini mengikuti conformance suite mereka sendiri.

Unsupported combination ditolak sebelum dispatch; platform tidak melakukan silent downgrade atau menerjemahkan agent semantics menjadi direct inference.

## 6. Deferred capability families

Candidate berikut sudah disebut roadmap tetapi **belum menjadi public v1 enum**: embeddings, reranking, vision/multimodal analysis, transcription/audio, image/media generation, dan capability lain yang muncul dari workload nyata.

Capability future mendapat ID/schema baru hanya setelah use case, input/output contract, accounting unit, adapter proof, data policy, dan acceptance gates didefinisikan. Contoh nama di discussion/roadmap tidak boleh dianggap API commitment.

Perubahan embedding/rerank model juga dapat memerlukan migrasi index/retrieval di aplikasi; platform capability tidak mengambil alih domain migration tersebut.

## 7. Capability publication rules

1. Capability schema disetujui dan machine-readable.
2. Minimal satu profile revision mengikat policy/limits/connection strategy yang valid.
3. Adapter/runtime mendeklarasikan support dan lulus conformance fixtures.
4. Security/accounting/stream/tool gates yang applicable mempunyai evidence.
5. Baru setelah itu status dapat naik ke `VERIFIED_FOR_PROFILE`.

Application meminta capability melalui profile yang diizinkan. Application tidak memilih provider secret, runner, plugin directory, atau unrestricted tool list lewat request body.

Related contracts: [API](API.md), [PROFILES-ADAPTERS](PROFILES-ADAPTERS.md), [TOOLS-PLUGINS](TOOLS-PLUGINS.md), [ARTIFACTS-SESSIONS](ARTIFACTS-SESSIONS.md), dan [CONTROL-PLANE](CONTROL-PLANE.md).
