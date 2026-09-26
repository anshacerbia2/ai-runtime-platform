# ADR-0016 — NestJS dengan Fastify sebagai HTTP adapter

**Tanggal:** 21 September 2026

**Status:** adopted untuk backend platform; local M0–M2 dan contract extensions terverifikasi pada evidence yang ditautkan di bawah.

**Menggantikan:** pilihan Fastify standalone pada [ADR-0015](0015-testable-milestone-slices.md), bukan batas contract-only M0.

## Implementation reconciliation — 24–26 September 2026

NestJS/Fastify now serves M0, M1, resource/runner-authority operations, and the M2 gateway/SSE endpoints. OIDC verification and nonlocal BFF code exist, but live issuer/deployment and production streaming/load performance are not proven. See [current source state](../implementation/CURRENT-STATE.md), [active HTTP operations](../implementation/HTTP-API.md), and [verification scope](../reviews/CONTRACT-EXECUTION.md). This note updates implementation status only; it does not create new reviewer approval or erase the original decision history.

## Context

User meminta stack tetap, kode readable, Clean Architecture, dan ADR atas pemilihan framework. Platform akan mempunyai identity, profiles, execution, accounting, gateway, serta runtime adapter. Struktur route yang menampung SQL, auth, dan orchestration sekaligus tidak memadai sebagai fondasi tersebut.

Masukan principal dalam percakapan mendukung Fastify untuk streaming, async handling, serialization, encapsulation, dan throughput. Masukan tersebut adalah pertimbangan reviewer, bukan benchmark atau hasil uji platform. Evaluasi faktual di bawah sengaja dibedakan dari klaim reviewer; keputusan tidak bergantung pada klaim bahwa Express pasti gagal.

## Decision

Gunakan **NestJS + official FastifyAdapter**. Nest mengatur composition modules, dependency injection, controller, guard, exception filter, serta lifecycle. Fastify menyediakan HTTP transport. Domain/use case tidak mengimpor salah satu framework tersebut; lihat [ADR-0018](0018-clean-architecture-quality.md).

Versi yang dipin pada refactor ini: Nest packages **12.0.3**, Fastify **5.12.4**, TypeScript **5.9.3**, Node major **24**. Package manifests dan lockfile merupakan sumber versi terpasang, bukan nama major dalam dokumen. Fastify mengikuti versi yang digunakan official Nest adapter; tidak memaksa dua instance/version yang berbeda. Nest mendokumentasikan Fastify sebagai adapter resmi.[^nest]

Nest controller hanya menangani transport dan memanggil use case. Auth guard memakai port credential verifier. Target autentikasi nonlokal tetap access token Keycloak yang diverifikasi (issuer, audience, signature, expiry, permissions), bukan client_id polos atau sistem API key kedua. Pada refactor awal, mode selain local bearer belum tersedia. Implementasi berikutnya menambah verifier OIDC/JWKS dan BFF nonlocal mode; live Keycloak provisioning tetap memerlukan evidence deployment, bukan hanya fixture tests.

## Masukan principal dan hasil verifikasi

| Bagian masukan                | Pernyataan reviewer                                                                    | Penilaian dan batas keputusan                                                                                                                                                                                                                                                                                                                           |
| ----------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A — SSE jangka panjang        | Express mempunyai overhead besar dan rawan dangling listener; Fastify hooks tanpa leak | Tidak ada heap profile, benchmark per-connection, atau leak reproduction yang disertakan. Fastify hooks bukan bukti bebas leak. `onResponse` berjalan setelah respons; `onRequestAbort` bukan jaminan seluruh kondisi putusnya outbound SSE. Cleanup listener, subscription, timer, buffer, dan upstream cancellation tetap kewajiban aplikasi.[^hooks] |
| B — Async/error               | Express 4 memerlukan penanganan rejected promise; Fastify mendukung async              | Kritik Express 4 tidak boleh digeneralisasi ke Express 5: handler yang mengembalikan Promise ditangani otomatis saat reject. Detached async work tetap perlu error handling. Dalam stack terpilih, exception handler Nest menormalkan error aplikasi; jangan mengandalkan satu hook Fastify untuk seluruh error.[^express-errors]                       |
| C — Serialization             | fast-json-stringify membuat JSON 2–4x lebih cepat dan menghemat ratusan ms             | Fastify menggunakan schema-driven serializer ketika response schema tersedia. Tidak otomatis aktif untuk setiap Nest response, dan raw SSE writes tidak otomatis memakai jalur ini. M0 belum mendaftarkan response schema Fastify; tidak diklaim mendapat percepatan tersebut.[^schema]                                                                 |
| D — Encapsulation             | Seluruh middleware Express global; fastify-plugin membuat isolasi                      | Express mempunyai router-level middleware. Fastify `register` membentuk scope; `fastify-plugin` justru dapat membuka batas encapsulation. Nest module graph bukan otomatis graph scope plugin Fastify.[^middleware][^encapsulation]                                                                                                                     |
| Tabel — Maintenance           | Express nyaris mati                                                                    | Tidak diadopsi sebagai fakta. Express menerbitkan kebijakan dukungan versi; keputusan kita bukan berdasarkan label tersebut.[^express-support]                                                                                                                                                                                                          |
| Tabel — Throughput/TTFT       | Fastify 2–3x dan microsecond overhead                                                  | Benchmark framework bukan SLO aplikasi, apalagi latency provider. Pilihan ini memberi jalur optimasi HTTP; angka throughput, memory, dan TTFT harus diukur pada build/profile/deployment sebenarnya.[^nest]                                                                                                                                             |
| Tabel — TypeScript/validation | Native TypeScript dan AJV/Zod otomatis menjaga kontrak                                 | Runtime shape tetap harus divalidasi. Baseline memakai Zod lewat policy adapter; generated JSON Schema/OpenAPI diuji drift. Fastify built-in memakai AJV, bukan integrasi Zod otomatis.[^schema]                                                                                                                                                        |
| Kesimpulan reviewer           | Fastify adalah keputusan 100% benar/standar industri                                   | Diadopsi sebagai pilihan proyek dengan trade-off dan acceptance criteria, bukan kebenaran universal atau sertifikasi produksi.                                                                                                                                                                                                                          |

## Alternatives considered

**NestJS + Express 5** tetap alternatif layak bila dependency khusus Express menjadi requirement dominan. Tidak dipilih karena proyek ini tidak memiliki dependency tersebut dan telah memilih Fastify. **Fastify standalone** dapat dibuat modular, tetapi meminta perakitan struktur/DI sendiri; dipindahkan ke Nest untuk consistency pengembangan. Framework tidak dipersalahkan atas kode monolitik awal.

## Consequences and verification

Gunakan plugin yang kompatibel Fastify; recipe Express, termasuk upload berbasis Multer, tidak dianggap kompatibel otomatis.[^upload] Transport-specific code berada di presentation/bootstrap saja. Nest decorator metadata dikompilasi `tsc`; use case plain TypeScript dapat diuji tanpa Nest.

M0–M2 diuji lewat Nest/Fastify HTTP injection, real PostgreSQL, browser flows, auth rejection, error envelope, data persistence, bounded provider SSE parsing/replay, slow-subscriber bounds, disconnect/resume semantics, dan cancellation/finalization behavior. **Production streaming load/leak certification belum dilakukan.** Sebelum streaming produksi, tetap uji disconnect berulang pada deployment nyata, listener/timer kembali ke baseline, bounded buffer, slow consumer, memory/RSS, event-loop delay, shutdown/timeout, dan provider/network faults; catat concurrency, durasi, percentile, serta kondisi upstream. Batasnya mengikuti [stream contract](../contracts/EVENTS-STREAMING.md) dan [gate](../testing/ACCEPTANCE.md).

## Evolution

Upgrade security/dependency mengulang build, contract, integration, browser, serta transport-specific tests. Dependency audit saat refactor mendorong pemilihan adapter dengan Fastify yang sudah diperbaiki, bukan downgrade demi mempertahankan versi awal. Revisit adapter hanya lewat bukti kebutuhan, bukan perubahan preferensi sesaat. Pilihan stack dan local M0–M2 closure tidak berarti platform telah production-ready.

## Referensi resmi

[^nest]: [NestJS — Performance/Fastify](https://docs.nestjs.com/techniques/performance).

[^hooks]: [Fastify — Hooks](https://fastify.dev/docs/latest/Reference/Hooks/).

[^express-errors]: [Express — Error handling](https://expressjs.com/en/guide/error-handling/), perilaku Promise pada Express 5.

[^schema]: [Fastify — Validation and serialization](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/).

[^middleware]: [Express — Using middleware](https://expressjs.com/en/guide/using-middleware/).

[^encapsulation]: [Fastify — Encapsulation](https://fastify.dev/docs/latest/Reference/Encapsulation/).

[^express-support]: [Express — Version support](https://expressjs.com/en/support/).

[^upload]: [NestJS — File upload](https://docs.nestjs.com/techniques/file-upload).
