# ADR-0016 — NestJS dengan Fastify sebagai HTTP adapter

**Tanggal:** 21 September 2026

**Status:** adopted untuk backend platform; implementasi terverifikasi sebatas M0.

**Menggantikan:** pilihan Fastify standalone pada [ADR-0015](0015-testable-milestone-slices.md), bukan batas contract-only M0.

## Context

User meminta stack tetap, kode readable, Clean Architecture, dan ADR atas pemilihan framework. Platform akan mempunyai identity, profiles, execution, accounting, gateway, serta runtime adapter. Struktur route yang menampung SQL, auth, dan orchestration sekaligus tidak memadai sebagai fondasi tersebut.

Masukan principal dalam percakapan mendukung Fastify untuk streaming, async handling, serialization, encapsulation, dan throughput. Masukan tersebut adalah pertimbangan reviewer, bukan benchmark atau hasil uji platform. Evaluasi faktual di bawah sengaja dibedakan dari klaim reviewer; keputusan tidak bergantung pada klaim bahwa Express pasti gagal.

## Decision

Gunakan **NestJS + official FastifyAdapter**. Nest mengatur composition modules, dependency injection, controller, guard, exception filter, serta lifecycle. Fastify menyediakan HTTP transport. Domain/use case tidak mengimpor salah satu framework tersebut; lihat [ADR-0018](0018-clean-architecture-quality.md).

Versi yang dipin pada refactor ini: Nest packages **12.0.3**, Fastify **5.12.4**, TypeScript **5.9.3**, Node major **24**. Package manifests dan lockfile merupakan sumber versi terpasang, bukan nama major dalam dokumen. Fastify mengikuti versi yang digunakan official Nest adapter; tidak memaksa dua instance/version yang berbeda. Nest mendokumentasikan Fastify sebagai adapter resmi.[^nest]

Nest controller hanya menangani transport dan memanggil use case. Auth guard memakai port credential verifier. Target autentikasi nonlokal tetap access token Keycloak yang diverifikasi (issuer, audience, signature, expiry, permissions), bukan client_id polos atau sistem API key kedua. Refactor ini tidak menyatakan integrasi Keycloak telah tersedia: mode local bearer M0 tetap terisolasi dan production mode ditolak.

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

M0 diuji lewat Nest/Fastify HTTP injection dan real PostgreSQL, browser flows, auth rejection, error envelope, dan data persistence. **SSE load/leak/replay/cancellation belum diuji karena execution streaming belum diimplementasikan.** Sebelum streaming produksi, uji disconnect berulang, listener/timer kembali ke baseline, bounded buffer, slow consumer, memory/RSS, event-loop delay, dan shutdown/timeout; catat concurrency, durasi, percentile, serta kondisi upstream. Batasnya mengikuti [stream contract](../contracts/EVENTS-STREAMING.md) dan [gate](../testing/ACCEPTANCE.md).

## Evolution

Upgrade security/dependency mengulang build, contract, integration, browser, serta transport-specific tests. Dependency audit saat refactor mendorong pemilihan adapter dengan Fastify yang sudah diperbaiki, bukan downgrade demi mempertahankan versi awal. Revisit adapter hanya lewat bukti kebutuhan, bukan perubahan preferensi sesaat. Pilihan stack layak dikembangkan menuju produksi tidak berarti M0 telah production-ready.

## Referensi resmi

[^nest]: [NestJS — Performance/Fastify](https://docs.nestjs.com/techniques/performance).

[^hooks]: [Fastify — Hooks](https://fastify.dev/docs/latest/Reference/Hooks/).

[^express-errors]: [Express — Error handling](https://expressjs.com/en/guide/error-handling/), perilaku Promise pada Express 5.

[^schema]: [Fastify — Validation and serialization](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/).

[^middleware]: [Express — Using middleware](https://expressjs.com/en/guide/using-middleware/).

[^encapsulation]: [Fastify — Encapsulation](https://fastify.dev/docs/latest/Reference/Encapsulation/).

[^express-support]: [Express — Version support](https://expressjs.com/en/support/).

[^upload]: [NestJS — File upload](https://docs.nestjs.com/techniques/file-upload).
