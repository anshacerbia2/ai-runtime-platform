# Kondisi Implementasi Aktual

**Diperiksa 25 September 2026 (Asia/Jakarta), pada working tree lokal di atas HEAD ccb86c9.** Halaman ini menjelaskan perilaku yang sudah ada, bukan seluruh target produk. Source yang dibaca, riwayat pengujian, dan batas sinkronisasi tercatat di [audit dokumentasi](../reviews/DOCUMENTATION-SYNC.md). Perubahan lokal belum berarti commit, deployment, atau persetujuan produksi.

## Cara membaca dokumentasi

Untuk menjawab “apa yang berjalan sekarang”, gunakan source, migration, kontrak HTTP yang terdaftar, dan hasil pengujian pada revisi yang sama. Dokumentasi kondisi aktual mengikuti bukti tersebut. [ADR](../adr/README.md) tetap menyimpan alasan keputusan dan perubahan historis; [rancangan target](../architecture/ARCHITECTURE.md) dan [PLAN](../PLAN.md) menyimpan pekerjaan yang belum terwujud. Selisih terhadap target ditandai sebagai gap, bukan diam-diam dianggap sudah terpenuhi atau dibuang.

## Ringkasan capability

| Area             | Sudah ada di source                                                                             | Batas yang belum terimplementasi / belum dibuktikan                                                           |
| ---------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Contract Lab     | Validasi shape/profile, hasil tersimpan, replay, history, schema explorer                       | Tidak memanggil model, tidak membuat execution atau ledger dari validasi M0                                   |
| Web/BFF          | Next.js App Router, entry, session/token custody server-side, OIDC flow, Markdown tersanitasi   | Integrasi live ATI Keycloak dan deployed Redis/ingress belum dibuktikan lokal                                 |
| Registry         | Application, connection, credential metadata/binding, profile revision/alias, budget, pool/node | Secret-manager resolver/rotation dan plugin registry belum tersedia                                           |
| Resource API     | Koleksi independen, cursor, DB projection, overview count, response per resource                | Bukan full management editor UI, full-detail API untuk semua resource, atau snapshot konsisten lintas-koleksi |
| Receipt/retry    | Mutation management dan receipt atomik, replay sebelum revision check, retry client terkontrol  | Tidak menjamin exactly-once provider/tool effect; tidak ada cleanup receipt otomatis                          |
| Accounting       | Admission/reservation, cumulative observations, ledger/adjustment, outbox/inbox                 | Tidak ada live provider billing, pricing oracle, atau enforcement multi-turn agent                            |
| Runner authority | Registrasi, grant/revoke manual, exact fencing, typed start/proposal, quarantine evidence       | Tidak ada autonomous dispatcher, process/sandbox supervisor, Redis runner lease, atau failover coordinator    |
| AI runtime       | Gateway `chat`/`generate`/`structured_generate`, OpenRouter + Direct Anthropic adapters, SSE/replay, durable provider invocation/result/usage, bounded fallback | Live vendor smoke belum tersedia di workstation; `agent_execute`, tools/plugins/workspace tetap belum berjalan |

`chat`, `generate`, dan `structured_generate` sudah memiliki jalur gateway lokal yang executable; `agent_execute` tetap **CONTRACT_ONLY** sampai M3 runtime tersedia. State runner STARTED atau proposal outcome completed tidak mengubah status `agent_execute` itu. Lihat [catalogue](../contracts/CAPABILITIES.md).

## Proses dan ownership yang nyata

Web menjalankan Next.js; API menjalankan NestJS dengan FastifyAdapter; PostgreSQL menyimpan schema m0 dan control. Local mode memakai token fixture server-side dan tidak membutuhkan issuer/Redis. Nonlocal mode memiliki kode OIDC dan Redis session store yang dikonfigurasi eksplisit. Session Redis bukan runner heartbeat Redis.

Source utama: [bootstrap](../../apps/api/src/bootstrap.ts), [composition](../../apps/api/src/app.module.ts), [web runtime](../../apps/web/src/server/runtime.ts), [single configuration gate](../../config/environment.mjs), dan [Prisma schema](../../prisma/schema.prisma). Versi terpasang berasal dari package manifests/lockfile, bukan versi vendor terkini.

API tidak menjalankan workflow bisnis aplikasi. BFF tidak mengakses database domain; browser tidak menerima provider/service token. Resource read/write operator bersifat platform-wide pada satu organisasi, sementara admission/execution/artifact application memakai scope aplikasi. Tidak ada tenant hierarchy atau resource-granular approval engine yang tersirat dari nama API.

## Permukaan HTTP aktif

[Daftar operasi aktual](HTTP-API.md) diturunkan dari [routes.ts](../../packages/contracts/src/http/routes.ts), [resources.ts](../../packages/contracts/src/http/resources.ts), dan [runner.ts](../../packages/contracts/src/http/runner.ts).

- /api/m0: lab lokal, validation-only.
- /api/v1: resource API baru dan assignment operator; assignment tidak diekspos oleh BFF browser.
- /api/runner/v1: protocol, reports, dan evidence khusus machine principal.
- /api/m1: compatibility surface yang masih aktif, termasuk admission/accounting/registrasi.
- /v1/chat, /v1/generate, /v1/executions, execution read/cancel, dan event stream: **aktif** melalui gateway M2; browser memakai mirror `/api/v1/...` pada BFF allowlist.

Generated [runtime OpenAPI](../../contracts/runtime.openapi.json) dan [BFF OpenAPI](../../contracts/bff.openapi.json) mendeskripsikan wire yang aktif. [Execution v1 OpenAPI](../../contracts/execution-v1.planned.openapi.json) adalah draft target. Jangan mengubah generated JSON secara manual untuk membuat fitur tampak tersedia.

## Mutation receipt dan optimistic concurrency

Resource mutations wajib memakai Idempotency-Key. Scope receipt adalah SHA-256 dari principal kind + authenticated subject, ditambah request key. Fingerprint mencakup version, operation kind, dan canonical command termasuk target serta expectedRevision. Mutation, audit, dan completed receipt commit bersama pada transaksi PostgreSQL Serializable yang pendek. Claim yang belum committed tidak menjadi lease IN_PROGRESS yang bisa dibaca client lain.

Replay memeriksa receipt sebelum mengulang expectedRevision. Key/payload sama mengembalikan hasil historis; key sama untuk command lain menghasilkan 409 IDEMPOTENCY_CONFLICT. Operasi baru dengan revision usang tetap conflict. Receipt memiliki replay window tujuh hari; record yang expired tetap ditahan dan ditolak dengan 410 REQUEST_KEY_EXPIRED. Tidak ada job otomatis untuk membebaskan key atau kebijakan retensi produksi yang disimpulkan dari konstanta ini.

Deferred constraint trigger melarang committed receipt yang belum lengkap. Jalur management receipted menggunakan retry transaksi terbatas, pemeriksaan elapsed budget 15 detik dan per-transaction wait/timeout yang diturunkan dari sisa budget; ini bukan hard guarantee cancellation end-to-end semua operasi. Legacy management tetap CAS tanpa receipt. Sumber: [mutation repository](../../apps/api/src/modules/control-plane/infrastructure/prisma-m1.repository.ts) dan [migration 0005](../../prisma/migrations/0005_contract_receipts/migration.sql).

## Query, projection, dan UI

Resource pages default 20, maksimum 100 item. Keyset umumnya id ascending; aliases memakai applicationId + profileRef. Cursor menyertakan resource dan caller scope, diverifikasi kembali sebelum query; cursor bukan credential dan bukan signature pemberi izin. UUID cursor ditolak sebelum masuk cast database bila tidak valid. Consistency dinyatakan live-keyset, bukan point-in-time snapshot.

DB select mengecualikan secretRef dari credential list dan payload dari outbox list. Overview berisi count sembilan registries dan observedAt dengan label independent-observations. List API juga memeriksa response envelope 1 MiB; jumlah item dan ukuran response bukan jaminan global heap/p99. Legacy snapshot menolak overflow pada koleksi yang dibatasi; legacy audit/outbox tetap bounded list lama dan bukan jalur console baru.

Control Plane UI mengambil koleksi secara independen saat tab dibuka, dengan Previous/Next/Refresh per koleksi; kegagalan satu koleksi tidak menghapus data koleksi lain. UI tidak menampilkan plugin manager atau menjalankan mutation resource melalui form editor. [Reader](../../apps/api/src/modules/control-plane/infrastructure/prisma-resource-reader.ts), [service](../../apps/api/src/modules/control-plane/application/resource.service.ts), [console](../../apps/web/src/features/control-plane/control-plane-page.tsx).

## HTTP client dan state Contract Lab

Client memakai unary JSON dengan safety ceiling 30 detik, response 8 MiB, diagnostic error 64 KiB; resource read dibatasi 1 MiB dan resource mutation 64 KiB melalui metadata operasi. BFF mempunyai konfigurasi batas tersendiri dan satu upstream attempt. Batas browser tidak mematikan transaksi atau provider secara otomatis.

Lab validation, M1 admission, dan receipt-backed resource mutations mengizinkan maksimal tiga attempt dari client yang sama. Key serta serialized body tidak berubah. Satu monotonic deadline mencakup seluruh attempt, pembacaan body dan backoff; Retry-After yang melebihi sisa budget menghentikan retry. Per-client budget awal 10 token, refill satu token/detik; bukan quota global. Kategori retry adalah network atau HTTP 502/503/504 yang tidak menyatakan retryable=false. Abort, expiry deadline, invalid response, dan 4xx termasuk 429 tidak mendapat retry otomatis pada implementasi ini.

Metadata assignment operator juga mendeklarasikan replay receipt, tetapi browser client tidak mengekspos assignment routes dan belum ada packaged runner SDK retry. Local BFF/HTTP timeouts bukan propagasi budget ke API/provider. Gateway memiliki local per-provider/model breaker dan bounded replay/resume, tetapi trace context end-to-end, distributed breaker state, deployed stream retention, dan load/SLO proof masih gap terpisah.

Mutation state lab: idle, pending, success, error, unknown. Pending meliputi retry otomatis. Hasil save yang terkonfirmasi langsung success; secondary health refresh memiliki lifecycle sendiri. Save dengan valid=false berarti laporan penolakan kontrak berhasil disimpan. Respons lama tidak boleh menimpa draft/scenario/key baru. Unknown setelah acknowledgement hilang bukan bukti rollback. [Client](../../apps/web/src/shared/api/http-client.ts), [retry policy](../../apps/web/src/shared/api/retry-policy.ts), [hook](../../apps/web/src/features/contract-lab/hooks/use-playground.ts).

## Gateway M2 lokal

Gateway memakai durable M1 admission/reservation sebelum provider dispatch. Application dan AI Connection mempunyai database-backed `gatewayMaxConcurrency` serta fixed-minute `gatewayRequestsPerMinute`; advisory transaction locks membuat concurrent admission untuk scope yang sama diserialisasi sebelum execution/hold dibuat. Shared connection dalam quota group wajib memakai gateway ceilings yang identik. Rejected capacity/rate admission tidak meninggalkan reservation.

Profile revision dapat menyimpan satu explicit fallback route. Fallback saat ini dibatasi ke alternate dedicated connection yang enabled, terikat ke application/profile, mempunyai central credential reference, dan berada pada environment yang sama. Runtime hanya berpindah ke durable attempt berikutnya ketika primary gagal dengan outcome `not-sent` sebelum provider-start/output/usage evidence. Partial atau ambiguous upstream outcome tidak di-splice; execution masuk reconciliation dan hold tetap tersedia untuk penyelesaian evidence.

OpenRouter stream wajib mencapai `[DONE]`; Direct Anthropic wajib mencapai `message_stop`. EOF tanpa terminal marker menjadi unknown/truncated, bukan success palsu. Provider success dan platform result validity dipisahkan: structured output yang invalid dapat membuat execution FAILED walaupun provider invocation SUCCEEDED; provider-reported usage yang lengkap tetap dapat diposting dan reservation diselesaikan. Replay stream dibatasi per execution/subscriber; cursor yang hilang/expired menghasilkan reset/expired semantics dan slow consumer tidak mendapatkan queue tak berbatas. Sumber: [gateway service](../../apps/api/src/modules/gateway/application/gateway.service.ts), [gateway repository](../../apps/api/src/modules/gateway/infrastructure/prisma-gateway.repository.ts), dan [gateway contract](../../packages/contracts/src/http/gateway.ts).

## Runner: authority kernel, bukan agent runtime

Token mengikat assignmentId, executionId, attemptId, runnerId, generation dan epoch ke ownerSubject terautentikasi. Grant/revoke/report diserialisasi melalui execution row lock; runner lifecycle dan pool eligibility ikut diperiksa. Generation harus tepat, bukan sekadar lebih besar dari nilai lama. State assignment adalah GRANTED, STARTED, RESULT_PROPOSED, FENCED.

Grant memeriksa expectedGeneration, execution nonterminal tanpa cancel intent, runner RUNNING, pool ENABLED, capability/connection profile, dan capacity. RESULT_PROPOSED tetap memakai capacity. Revocation menambah generation barrier; setelah grant 1, revoke membawa barrier ke 2 dan grant baru dapat menjadi 3. Epoch disimpan, tetapi automatic epoch rebuild belum tersedia.

Start dapat mengubah execution menjadi RUNNING. Result proposal disimpan dan menghasilkan satu outbox event; tidak mengubah execution menjadi COMPLETED/SUCCEEDED, tidak mempromosikan artifact, dan tidak mengubah ledger. API masih dapat memberikan assignment pada attempt yang sudah ada: ini bukan implementasi retry agent yang membuat attempt baru dan memeriksa penghentian proses lama.

Evidence dari assignment lama yang dikenal tetap dapat masuk sebagai QUARANTINED, dengan dedup source identity dan penolakan digest berbeda. Semua intake ini terpisah dari ledger; belum ada automated verifier yang memindahkan quarantine ke settlement. Fencing tidak membatalkan remote effect yang sudah terjadi. [Runner authority](../../apps/api/src/modules/control-plane/infrastructure/prisma-runner-authority.ts), [runner contract](../../packages/contracts/src/http/runner.ts), [migration 0006](../../prisma/migrations/0006_runner_authority/migration.sql).

## Database dan representasi

Migration 0001–0010 membentuk registry, admission/accounting, receipt, runner authority, gateway result/invocation, database-backed admission capacity/rate windows, explicit fallback policy, dan invocation-to-connection attribution. ManagementReceipt berbeda dari InboxReceipt. AuditEntry berisi metadata actor/action/resource/revision/time, bukan raw prompt/log; OutboxEvent mempunyai payload JSON, tetapi list resource barunya tidak mengambil payload itu.

Uang/unit presisi tinggi disimpan sebagai BigInt dan dipresentasikan sebagai decimal string; timestamp wire berupa ISO string. Explicit mappers dan finite-JSON validator menggantikan stringify/parse normalization. Serialization AST gate memeriksa seluruh source API buatan tim, tidak termasuk generated client; ia bukan whole-program alias/taint proof. [Mapper](../../apps/api/src/modules/control-plane/infrastructure/wire-mappers.ts), [JSON boundary](../../apps/api/src/shared/infrastructure/json-value.ts), [gate](../../scripts/check-serialization.mjs).

## Batas bukti

Penutupan implementasi sebelum sinkronisasi ini mencatat verify, migrations, dan 21 E2E PASS; rinciannya [CONTRACT-EXECUTION](../reviews/CONTRACT-EXECUTION.md). Hasil historis itu terikat source digest yang dicatat. Pemeriksaan dokumentasi menemukan perubahan lokal pada use-workspace.ts dan use-resource-query.ts setelah snapshot pengujian sebelumnya; dua file itu dibaca ulang dan tidak ditimpa oleh tugas dokumentasi ini. Hasil fresh checks dan perlindungan source dicatat terpisah di [DOCUMENTATION-SYNC](../reviews/DOCUMENTATION-SYNC.md).

Belum dibuktikan: live OpenRouter/Anthropic smoke pada workstation ini (credential environment tidak tersedia), deployed Keycloak/Redis, runner multi-machine operational recovery, sandbox/egress agent runtime, polyglot SDK conformance, persistent Broker production rollout, production load/chaos/SLO, pricing/retention approval. SSE gateway/replay lokal sudah diimplementasikan dan diuji; ini belum sama dengan deployment/load proof produksi. Pernyataan marketing di entry page atau schema PLANNED tidak menjadi bukti runtime.
