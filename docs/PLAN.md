# AI Runtime Platform — Implementation Plan

**Arsitektur baseline 0.2; M0 technical slice tersedia dalam 0.3.0-m0.** P0 formal reviewer closure tetap IN PROGRESS. P1 dan P2 sekarang LOCAL IMPLEMENTATION COMPLETE dengan evidence lokal; external/nonlocal integration, authorized live provider smoke, dan production readiness tetap pending. Deliverable runtime P3–P7 belum selesai; fondasi P3 sekarang mencakup registry/manual fencing, exact Redis lease dan process presence, encrypted durable dispatch envelope, autonomous initial pull placement, serta lease-gated runner reports melalui ADR-0029–ADR-0031. [M0 evidence](milestones/M0.md), [M1 evidence](milestones/M1.md), [current state](implementation/CURRENT-STATE.md), dan [panduan lokal](development/M0.md).

Dokumen ini menjelaskan urutan kerja, dependency, deliverable, dan gate. M0 menambahkan Contract Lab FE/BE/DB sesuai [ADR-0015](adr/0015-testable-milestone-slices.md); ini bukan implementasi gateway/agent/ledger produksi. Deliverable di bawah tetap dibedakan dari demonstrasi lokal. Rujukan keputusan: [ADR](adr/README.md). Gambaran sistem: [Architecture](architecture/ARCHITECTURE.md). Pemetaan keputusan ke spesifikasi/gate: [decision traceability](reviews/RECONCILIATION.md).

## Stack implementasi tetap

NestJS + Fastify + Prisma + PostgreSQL, React/Next.js App Router + BFF, TypeScript strict, Prettier, ESLint, dan dependency rules. M0 sudah direfactor; M1 dan berikutnya memakai boundary yang sama. Lihat [ADR-0016](adr/0016-nestjs-fastify.md), [ADR-0017](adr/0017-prisma-postgresql.md), [ADR-0018](adr/0018-clean-architecture-quality.md), [ADR-0026](adr/0026-nextjs-bff.md), dan [code structure](architecture/CODE-STRUCTURE.md). Perubahan stack bukan penutupan production readiness gate.

## Checkpoint implementasi 26 September 2026

M0–M2 local closure sekarang mencakup HTTP/UI hardening, /api/v1 resource APIs, count overview, receipt atomik, retry per operasi, explicit mappers/AST gate, /api/runner/v1 authority messages, serta gateway executable untuk chat/generate/structured_generate dengan OpenRouter + Direct Anthropic adapters, bounded SSE/replay, structured-output validation, database-backed admission capacity/rate limits, safe not-sent fallback, durable provider invocation/result, dan accounting evidence. Migration 0005–0010 sudah applied lokal. [Source status](implementation/CURRENT-STATE.md) dan [test evidence](reviews/CONTRACT-EXECUTION.md) memisahkan implementasi lokal dari deployment/production approval.

Sisa P3 tetap payload delivery, automatic reassignment, runtime/sandbox, provider/tool effect safety dan streaming. Bounded lease-loss suspension dan pause/fence/reopen epoch setelah marker Redis hilang sudah tersedia lokal, tetapi belum menghentikan proses atau mengotorisasi retry; chaos failover nyata masih pending. Tidak perlu mengimplementasikan ulang registry/fencing/initial-placement kernel yang sudah ada; perluas kernel tersebut dan buktikan integrasi runtime-nya. P0 governance dan P3.5 sign-off tidak ditutup hanya oleh pembaruan dokumentasi.

## 1. Batas pekerjaan

Produk: AI execution bersama, bukan business workflow engine. Scope capability v1: `chat`, `generate`, `structured_generate`, dan `agent_execute` sesuai [CAPABILITIES](contracts/CAPABILITIES.md). Scope implementasi awal: OpenRouter + pembuktian satu direct provider; Claude runtime; durable audit/admission; plugin dan artifact contract; reliability/security sebelum migrasi produksi.

Tidak termasuk saat ini: business-job database bersama, universal agent translator, cross-runtime live session migration, semua provider, full plugin marketplace, distributed workflow engine baru, atau autonomous model selection tanpa evaluasi.

## 2. Urutan dan work packages

### P0 — Contract dan decision closure

**Status:** runnable lab tersedia; formal contract/reviewer closure belum selesai. Shared schemas dan validation history nyata dapat dicoba dari UI tanpa membuat AI execution. Setiap fase berikutnya harus menyertakan demo FE + BE + DB, recipe uji, serta batas fitur yang masih planned. Detail scope P0.1–P0.5: [M0](milestones/M0.md).

**Dependency:** baseline dokumentasi ini. **Penanggung jawab peran:** platform architect + app owners + security/accounting reviewers; individu belum ditetapkan.

| WP   | Deliverable implementasi berikutnya                     | Acceptance                                                                     |
| ---- | ------------------------------------------------------- | ------------------------------------------------------------------------------ |
| P0.1 | Shared schemas/routes TypeScript dan generated OpenAPI  | Chat tanpa process/plugin, Scribe agent, structured result dapat diekspresikan |
| P0.2 | State/error/event schema, compatibility policy          | Enum dan transition selaras; completion tidak menunggu settlement              |
| P0.3 | Profile/connection/plugin/runner/tool/adapter contracts | Unsupported capability/connection/placement ditolak sebelum dispatch           |
| P0.4 | Threat model dan data classification                    | Credential mode, sandbox, retention, egress disetujui untuk workload pilot     |
| P0.5 | Close blocking open decisions                           | Owner, target, environment, gate parameters tercatat                           |

**Exit:** review kontrak dan ADR baseline selesai; tidak ada P0 blocker di [open decisions](decisions/OPEN-QUESTIONS.md). Kontrak bukan dianggap lulus hanya karena contoh JSON dapat diparse.

### P1 — Durable control plane dan accounting foundation

**Status:** LOCAL IMPLEMENTATION COMPLETE — durable identity/control-plane/admission/accounting foundation dan P1 local acceptance evidence tersedia. Live Keycloak sign-in, deployed BFF/Redis session evidence, concrete secret-manager, Redis hot runner state, dan nonlocal production evidence tetap pending. Evidence: [M1](milestones/M1.md).

**Dependency:** P0. **Owner roles:** platform backend + storage/security.

Fondasi lokal sudah menyediakan verifier boundary dan registries berikut; deployment masih membutuhkan Keycloak-backed authentication/authorization per aplikasi, **Application Registry, AI Connection Registry, Credential Binding, Runner Registry/Pool**, profile registry/version snapshot, idempotency record, execution/attempt state, budget account/reservation/observation/ledger, durable cancel intent, outbox/inbox, audit query, dan artifact metadata. Implementasi awal memilih PostgreSQL sebagai correctness authority, Redis untuk hot runner/lease/capacity tier. Actual provider secret berada di secret manager/workload identity atau runner-local store; database hanya menyimpan reference/metadata. Budget transaction memeriksa semua scope dalam urutan lock stabil; rejected reservation tidak mengubah pool.

**Exit:** G01, G02, G07, G08, G09, G15, G26–G29 pada test catalogue lulus di test environment. Replay command idempotent, crash injection tidak menghasilkan free dispatch atau duplicate credit. Machine schema/migrations dan versioning review tersedia. Ledger dapat menjelaskan held, posted, pending, overage tanpa mengubah unknown menjadi zero.

### P2 — Direct & Aggregator Gateway MVP

**Status:** LOCAL IMPLEMENTATION COMPLETE — public gateway routes, dual adapters, bounded SSE/replay, database-backed admission capacity/rate limits, structured-output validation, explicit safe fallback, durable provider invocation/result and accounting evidence are implemented locally. Authorized live OpenRouter/Anthropic smoke and broader deployed/load evidence remain pending.

**Dependency:** P1. **Owner roles:** gateway + app pilot owners.

Implementasikan OpenRouterAdapter terlebih dahulu, lalu DirectAnthropicAdapter untuk membuktikan common interface pada chat, streaming, dan structured generation yang keduanya benar-benar mendukung. Runtime Codex tidak disamakan dengan OpenAI provider API. Routing primary/fallback ditentukan profile; OpenRouter tetap dapat primary. Gateway harus resolve **AI Connection + credential binding** server-side; caller tidak memilih API key/account. Dedicated dan explicitly shared connections diuji termasuk shared upstream quota groups.

Tambahkan per-app/pool concurrency, rate limits, token/output bounds, deadline, circuit breaker, restricted routing/data policy, provider request ID capture, usage extraction, explicit retry attempts, serta resumable stream contract. Direct path tidak masuk long-agent queue; tetap memakai durable admission dan status finalization.

**Exit:** G03, G10, G11, G16, G17, G21, G22, G28, G31 lulus dengan fake adapter untuk failure injection dan live smoke test terotorisasi untuk mapping provider. Dual adapter bukan bukti failover sampai skenario failover diuji. Tidak ada automatic fallback setelah partial output tanpa new-attempt/reset semantics.

### P3 — Claude Agent Runtime MVP

Checkpoint kernel/crash 20 Oktober 2026: native bounded cgroup2 inspection supplies the driver port; real nested-process and live-owner SIGKILL experiments require nonempty orphan evidence, stale-lock refusal/no-rerun and explicit runtime/subtree/original-monitor cleanup. Stale locks remain blocked even after cleanup. This advances live-orphan evidence without adding production takeover, retirement or full host composition. [Scope](development/NATIVE-CGROUP-OWNER-CRASH.md).

Checkpoint native CLI 20 Oktober 2026 menambahkan pinned executable checks, fixed runsc command surface, bounded output/admission/deadlines dan attached monitors pada real driver conformance. Monitor loss tetap LOST; timeout tidak mengotorisasi stop/retry, dan fresh work diblokir sampai recovery eksplisit. Whole-host ownership/cgroup/readiness composition, live-orphan crash, trusted release/credential delivery serta Claude/egress tetap dependency. [Scope](development/NATIVE-RUNSC-PROCESSES.md).

Checkpoint bundle 20 Oktober 2026 menambahkan full-tree rootfs content verification dari trusted manifest pin, readonly independent copies dan fixed OCI policy, dipakai real gVisor conformance sebelum reservation/dispatch. Production image approval/provenance dan native host lifecycle/recovery masih dependency; content hashing bukan penutupan O03 atau Claude compatibility. [Scope](development/VERIFIED-RUNSC-BUNDLES.md).

Checkpoint private launch storage: async Linux reservations dengan exclusive lock, no-clobber fsync commit dan fail-closed recovered read/replay kini dipakai real gVisor probe. Pre-spawn process-crash proof tidak mengizinkan automatic unlock/retirement/reassignment. Native live-orphan recovery, verified image, Claude/credential/egress dan actual VPS tetap berikutnya. [Scope](development/RUNSC-LAUNCH-STORE.md).

Checkpoint sandbox candidate: Linux VM/VPS sudah dipilih owner sebagai hosting direction. Real gVisor `systrap` fixture gate menguji lifecycle/basic containment dan applied resource limits pada ephemeral Linux CI. [Driver/supervisor lifecycle](development/RUNSC-DRIVER.md) kini tersedia dengan real runsc fixture host. Production host/storage lock/image verification, full worker lease integration, Claude compatibility, broker egress, hard-crash/VPS-specific evidence serta O03 disposition tetap berikutnya. [Eksperimen](security/SANDBOX-EVALUATION.md#linux-vmvps-experiment). Tidak ada perubahan ADR.

Checkpoint tool-operation reads: aplikasi dapat list/read durable status operasinya melalui backend API terisolasi per execution/aplikasi. Unknown dan terminal receipts dipertahankan setelah fence/retention expiry tanpa invoke/retry/settlement. Ini menutup bagian read API untuk rekonsiliasi aplikasi; authorized invocation, receiver conformance, runtime/sandbox dan retirement tetap dependency M3. [Scope](development/M3.md#application-tool-operation-status). Tidak ada keputusan arsitektur baru.

Checkpoint coordinator outcomes: durable quarantined stop intake dan read-only canonical result matching tersedia, dengan exact original process binding, audit/outbox atomik dan explicit runner client. Independent stop/effect verification, safe journal/tombstone retirement dan reassignment tetap belum aktif; production identity/KMS/storage serta sandbox/runtime tetap berikutnya. [Semantik](development/M3.md#coordinator-stop-receipt-dan-result-reconciliation). Tidak ada perubahan ADR.

Checkpoint outcome journal 19 Oktober 2026 menyediakan encrypted candidate sebelum result HTTP dan immutable local stop evidence dengan reserved capacity, bounded cipher wait dan fail-closed recovery. Local journal tidak mengotorisasi retry/finalization/reassignment; coordinator receipt intake/reconciliation/retirement tetap berikutnya bersama production host/KMS/storage/retention dan sandbox/runtime. [Semantik](development/M3.md#durable-result-candidate-dan-local-stop-journal). Ini memperluas collector checkpoint di bawah tanpa mengubah ADR.

Checkpoint collector 19 Oktober 2026: optional durable write-before-send evidence collector dan Linux encrypted bounded spool tersedia sebagai komponen programatik, dengan explicit replay ke quarantine existing. Pending/backlog/key/storage failure menolak spend baru; tidak mengotorisasi result retry atau settlement. Linux CI mencakup process crash dan committed-ACK loss/reopen/replay melalui coordinator B. Production cipher/KMS, collector I/O isolation dan host flush lifetime, persistent-volume/node-loss/retention proof, result-candidate persistence, stop receipts dan real sandbox/runtime tetap dependency berikutnya. Ini memperluas baseline reporting di bawah tanpa mengubah ADR atau pilihan deployment. [Detail dan batas](development/M3.md#bounded-evidence-collector-dan-encrypted-file-spool).

**Status:** IN PROGRESS — coordination lease/presence, encrypted dispatch envelope, connection-locality-aware initial pull placement, lease-gated start/result reports, bounded lease-loss suspension, epoch pause/fence/reopen, internal scoped payload read, tool-effect intent/status recovery, registry/pinning/materializer plugin, Ed25519 stored-package verification, bounded S3 reader, internal lease-scoped plugin delivery, dan boundary supervisor lokal tersedia; production activation untuk payload/plugin HTTP handoff, real Redis failover chaos, automatic reassignment, production signer trust/provenance wiring, sandbox execution, authorized tool broker, artifact promotion, production KMS, dan retention approval masih pending.

**Dependency:** P1; P2 common contracts. **Owner roles:** runtime + security + Scribe owner.

Slice lifecycle satu assignment mengintegrasikan HTTP activation/renew, gate monotonic, renewal/watchdog, dan supervisor lokal dalam `RunnerAssignmentLifecycle`. `RunnerWorker` kini menambahkan bootstrap programatik untuk heartbeat/claim, satu lifecycle/nonce per assignment, scoped start report, capacity, serta shutdown/drain berbatas. Harness fixture membuktikan ordering dan failure races; host registration/credential delivery, durable cancel/fence/result/evidence integration, aktivasi produksi authenticated payload/plugin delivery, pilihan adapter sandbox O03, dan Claude runtime tetap berikutnya. Komposisi ini belum mengaktifkan `agent_execute` end-to-end. Lihat [M3 development](development/M3.md).

Handoff worker lokal 19 Oktober 2026 menambahkan binary download terikat lease/envelope dan `context.withInputs` sekali per assignment, setelah STARTED. Paket diverifikasi sebelum trusted callback; byte buffer pinjaman dihapus pada abort/settlement callback. HTTP loopback fixture mencapai materialisasi file inert dalam private root. Aktivasi route coordinator dengan KMS/storage/signer trust produksi dan sandbox/Claude nyata tetap pending; ini tidak menutup production gate atau mengubah ADR. Detail dan batas fixture: [payload/plugin handoff](development/M3.md#payloadplugin-handoff-ke-trusted-runtime).

Integrasi authority/reporting 19 Oktober 2026 memakai endpoint renew existing untuk durable cancel/fence preflight sebelum setiap `context.runStep`, menambahkan satu typed result proposal setelah runtime return, dan intake evidence quarantine yang tetap tersedia setelah local stop. Loopback worker dan test PostgreSQL membuktikan scope/ordering/dedup yang dicakup; external dispatch tidak atomik dengan cancel, dan proposal/intake tidak melakukan completion/settlement. Berikutnya tetap durable collector/spool dan stop receipts, real sandbox/runtime, production delivery wiring, serta broader recovery/chaos. [Semantik dan batas](development/M3.md#durable-authority-result-proposal-dan-late-evidence).

Gate worker HTTP berikutnya menjalankan dua API proses independen dengan shared PostgreSQL/Redis dan fixture runtime/sandbox. Ia memeriksa A→B coordinator continuation, lost ACK, durable cancel, missing lease/reaper fencing, held budget dan late evidence. Mode auth tetap `m0-local`; nonlocal epoch/Redis failover dan runtime isolation belum dibuktikan. [Recipe gate](development/M3.md#worker-http-dengan-dua-coordinator-dan-shared-storage). Tidak ada perubahan ADR atau aktivasi endpoint payload produksi.

Ekstrak boundary Claude runner, bukan memindahkan workflow Scribe. Perluas registry/pools, capability advertisement, lifecycle dan durable assignment/generation yang sudah tersedia. Initial connection-locality-aware pull placement dan exact-process presence sudah ada; lanjutkan dengan **derived OFFLINE dan safe reassignment**, worker supervisor, compare-and-renew Redis lease pada grant, Redis recovery epoch, bounded payload delivery, sandbox, scoped credential injection, **Plugin Registry materialization**, package digest validation, optional workspace contract, tool broker, artifact manifest, runtime session scope, cancellation propagation, late usage ingestion, serta orphan quarantine.

Stateful tool hanya tersedia jika receiver idempotency/status contract tervalidasi. Remote capability boleh MCP atau typed HTTP/RPC; MCP bukan kewajiban aplikasi. Workspace `none|ephemeral|artifact_workspace` dipilih profile, sehingga direct chat tidak membawa filesystem/plugin contract palsu. Prototype read-only/script artifact path terlebih dahulu; final publish tetap di app. Budget multi-turn memakai envelope penuh atau authorized tranche, tidak hanya satu output-token limit.

**Exit:** G04, G05, G06, G12, G13, G14, G18, G19, G20, G30, G32–G34 lulus pada runtime harness. Bukti penghentian process tree, stale-writer rejection, serta partial/unknown usage tersedia. No-host-secrets dan egress tests tidak boleh ditunda ke production.

### P3.5 — Core Reliability & Security Gate

**Dependency:** P1–P3 selesai pada build kandidat yang sama. **Status sekarang:** BLOCKED — live provider/agent runtime dan full production-gate evidence belum tersedia; local foundation tests tidak menggantikannya.

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

## 5. Cross-cutting workstreams

Req 21–22 September menambah lima workstream lintas phase:

1. **Application & Connection Control (P1):** Keycloak mapping, Application Registry, AI Connection Registry, credential instances/bindings, dedicated/shared allow-list, secret references, Admin UI foundation.
2. **Plugin Packaging (P2–P3):** immutable plugin registry/version/digest/compatibility, ephemeral materialization, supply-chain verification.
3. **Workspace & Remote Tools (P3):** optional workspace modes, generic artifact promotion, MCP/HTTP/RPC remote tools without making MCP mandatory.
4. **Distributed Fleet (P1 registry; P3 placement):** runner self-registration, pools, capability/capacity/connection advertisement, Redis liveness, drain/offline/disable, placement and quota-group awareness.
5. **External App + BFF + CDD Frontend (P1 onward):** Next.js App Router dengan BFF tier, dedicated Keycloak client dan Authorization Code sign-in dari entry page milik platform, session/token custody server-side, cookie contract, server-rendered `docs/` surface, AI Platform semantic design tokens, component-driven primitives/components/compositions, serta isolated accessibility/visual-regression coverage. Lihat [ADR-0025](adr/0025-external-app-standalone-auth.md) dan [ADR-0026](adr/0026-nextjs-bff.md).

P1 nonlocal readiness wajib mencakup Keycloak sign-in/callback registration, BFF token custody, session isolation, dan application-scoped authorization. P3.5 tetap wajib menguji cross-app connection isolation, plugin/workspace containment, runner-local credentials, shared-account quota semantics, drain/failover, dan fencing sebelum P4 production migration.
