# AI Runtime Platform — Implementation Plan

**Baseline 0.2 · 20 September 2026 · Semua pekerjaan implementasi di bawah: PLANNED.**

Dokumen ini menjelaskan urutan kerja, dependency, deliverable, dan gate. Pembaruan Markdown bukan implementasi service, migration database, SDK, test suite, atau deployment. Rujukan keputusan: [ADR](adr/README.md). Gambaran sistem: [Architecture](architecture/ARCHITECTURE.md). Pemetaan keputusan ke spesifikasi/gate: [decision traceability](reviews/RECONCILIATION.md).

## 1. Batas pekerjaan

Produk: AI execution bersama, bukan business workflow engine. Scope awal: direct chat/generate/structured generation; OpenRouter + pembuktian satu direct provider; Claude runtime; durable audit/admission; plugin dan artifact contract; reliability/security sebelum migrasi produksi.

Tidak termasuk saat ini: business-job database bersama, universal agent translator, cross-runtime live session migration, semua provider, full plugin marketplace, distributed workflow engine baru, atau autonomous model selection tanpa evaluasi.

## 2. Urutan dan work packages

### P0 — Contract dan decision closure

**Dependency:** baseline dokumentasi ini. **Penanggung jawab peran:** platform architect + app owners + security/accounting reviewers; individu belum ditetapkan.

| WP | Deliverable implementasi berikutnya | Acceptance |
| --- | --- | --- |
| P0.1 | Machine-readable API schema dari kontrak Markdown | Chat tanpa process/plugin, Scribe agent, structured result dapat diekspresikan |
| P0.2 | State/error/event schema, compatibility policy | Enum dan transition selaras; completion tidak menunggu settlement |
| P0.3 | Profile/tool/adapter conformance contracts | Unsupported capability ditolak sebelum dispatch |
| P0.4 | Threat model dan data classification | Credential mode, sandbox, retention, egress disetujui untuk workload pilot |
| P0.5 | Close blocking open decisions | Owner, target, environment, gate parameters tercatat |

**Exit:** review kontrak dan ADR baseline selesai; tidak ada P0 blocker di [open decisions](decisions/OPEN-QUESTIONS.md). Kontrak bukan dianggap lulus hanya karena contoh JSON dapat diparse.

### P1 — Durable control plane dan accounting foundation

**Dependency:** P0. **Owner roles:** platform backend + storage/security.

Bangun authentication/authorization per aplikasi, profile registry/version snapshot, idempotency record, execution/attempt state, budget account/reservation/observation/ledger, durable cancel intent, outbox/inbox, audit query, artifact metadata. Implementasi awal memilih PostgreSQL sebagai correctness authority, Redis untuk hot tier. Budget transaction memeriksa semua scope dalam urutan lock stabil; rejected reservation tidak mengubah pool.

**Exit:** G01, G02, G07, G08, G09, G15 pada test catalogue lulus di test environment. Replay command idempotent, crash injection tidak menghasilkan free dispatch atau duplicate credit. Machine schema/migrations dan versioning review tersedia. Ledger dapat menjelaskan held, posted, pending, overage tanpa mengubah unknown menjadi zero.

### P2 — Direct & Aggregator Gateway MVP

**Dependency:** P1. **Owner roles:** gateway + app pilot owners.

Implementasikan OpenRouterAdapter terlebih dahulu, lalu DirectAnthropicAdapter untuk membuktikan common interface pada chat, streaming, dan structured generation yang keduanya benar-benar mendukung. Runtime Codex tidak disamakan dengan OpenAI provider API. Routing primary/fallback ditentukan profile; OpenRouter tetap dapat primary.

Tambahkan per-app/pool concurrency, rate limits, token/output bounds, deadline, circuit breaker, restricted routing/data policy, provider request ID capture, usage extraction, explicit retry attempts, serta resumable stream contract. Direct path tidak masuk long-agent queue; tetap memakai durable admission dan status finalization.

**Exit:** G03, G10, G11, G16, G17, G21, G22 lulus dengan fake adapter untuk failure injection dan live smoke test terotorisasi untuk mapping provider. Dual adapter bukan bukti failover sampai skenario failover diuji. Tidak ada automatic fallback setelah partial output tanpa new-attempt/reset semantics.

### P3 — Claude Agent Runtime MVP

**Dependency:** P1; P2 common contracts. **Owner roles:** runtime + security + Scribe owner.

Ekstrak boundary Claude runner, bukan memindahkan workflow Scribe. Implementasikan worker supervisor, assignment generation, compare-and-renew Redis lease, Redis recovery epoch, bounded dispatch, sandbox, scoped credential injection, package digest validation, tool broker, artifact manifest, runtime session scope, cancellation propagation, late usage ingestion, serta orphan quarantine.

Stateful tool hanya tersedia jika receiver idempotency/status contract tervalidasi. Prototype read-only/script artifact path terlebih dahulu; final publish tetap di app. Budget multi-turn memakai envelope penuh atau authorized tranche, tidak hanya satu output-token limit.

**Exit:** G04, G05, G06, G12, G13, G14, G18, G19, G20 lulus pada runtime harness. Bukti penghentian process tree, stale-writer rejection, serta partial/unknown usage tersedia. No-host-secrets dan egress tests tidak boleh ditunda ke production.

### P3.5 — Core Reliability & Security Gate

**Dependency:** P1–P3 selesai pada build kandidat yang sama. **Status sekarang:** BLOCKED — belum ada runtime dan bukti test.

Jalankan seluruh [acceptance catalogue](testing/ACCEPTANCE.md) sesuai applicable capability. Setiap test mempunyai build/image digest, fixture, parameter, expected result, actual result, trace/evidence ID, reviewer, dan tanggal. Semua safety tests wajib pass; N/A membutuhkan alasan dan persetujuan scope, bukan digunakan untuk melewati fitur yang dipakai pilot.

Gate mengikuti [ADR-0013](adr/0013-evolution-gates.md): worker chaos, SSE, budget race, late usage, sandbox, compare-renew, Redis loss, ordinary exit, completion-before-settlement, settlement crash, multi-turn budget, duplicate/cumulative evidence, external ambiguity, authorization, rollback, dan data deletion.

**Exit:** gate report ditandatangani owner platform, app pilot, security, operations. Target SLO/retention/overage terkalibrasi; runbooks dan rollback rehearsed. Status adopted pada ADR tidak menggantikan gate evidence.

### P4 — Migrasi aplikasi bertahap

**Dependency:** P3.5 untuk workload produksi; eksperimen nonproduksi dapat berlangsung lebih awal tanpa data/credential produksi.

Urutan pilot: direct-chat/simple-inference nonproduksi untuk menguji agnosticism; Scribe agent pilot; satu inference workload sempit; Farexlate; selected RAG calls. Urutan cutover produksi ditetapkan dari risiko dan kesiapan app, bukan angka urut yang memaksa workload kritis lebih dulu.

Setiap migrasi: inventaris contract/secrets, capture quality baseline, map process/step, canary traffic, limits, usage reconciliation, observability, rollback ke jalur lama, lalu decommission setelah masa evaluasi. Shadow test mutasi dilarang; inference shadow memerlukan budget/data approval.

**Exit:** owner app menerima quality/latency/cost-per-accepted-output, isolation, failure behavior, dan rollback. Business job tetap di aplikasi. Lihat [APPLICATIONS](migration/APPLICATIONS.md).

### P5 — Codex runtime adapter

**Dependency:** stable runtime contract dan P3.5 controls. Gunakan integrasi programatis resmi yang diverifikasi saat implementasi; pilihan SDK/transport dicatat sebagai versioned binding. Jangan mengganti nama Codex menjadi direct Responses API provider.

Deliverable: adapter, capability/version matrix, event/usage mapping, permission enforcement, one-workload plugin packaging, same-runtime session support bila dibuktikan. **Exit:** runtime conformance, security, chaos, audit, dan quality acceptance untuk minimal satu workload nyata; perubahan runtime tidak memaksa caller mempelajari sintaks vendor.

### P6 — Gemini runtime adapter

**Dependency:** contract/gates yang sama. Headless/SDK choice dan credential mode diverifikasi ulang sebelum implementasi. Deliverable/exit sama dengan P5; ketidaktersediaan fitur dilaporkan eksplisit. Codex dan Gemini tidak otomatis compatible dengan semua plugin Scribe.

### P7 — Evidence-driven expansion

Tambahkan provider langsung lain, embeddings/reranking/vision/transcription, HA/scaling, advanced routing, SDK packaging, atau workflow technology hanya jika workload dan evidence menuntutnya. Kontrol minimum safety bukan item P7. Perubahan embedding model adalah migrasi retrieval/index aplikasi yang terpisah.

## 3. Dependency dan parallel work

P0 mengunci vocabulary; P1 mengunci durability/identity. Setelah itu gateway dan agent dapat dikerjakan paralel oleh owner berbeda melalui contract fixtures. API schema changes membutuhkan compatibility review sebelum kedua jalur merge. Tidak ada cutover produksi sebelum applicable gates.

## 4. Definition of done

Sebuah phase selesai bila deliverable ada, test evidence tersedia, source/contract/diagram selaras, security/data requirements ditinjau, dan rollback/operasi didokumentasikan. Build pass atau diagram rapi sendiri tidak cukup. [ROADMAP](ROADMAP.md) hanya merangkum status phase, bukan menggandakan requirement detail.
