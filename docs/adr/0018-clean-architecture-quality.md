# ADR-0018 — Clean Architecture dan readability sebagai aturan teruji

**Tanggal:** 21 September 2026

**Status:** adopted untuk semua source yang ditulis tangan.

**Terkait:** [ADR-0012](0012-deployment-dispatch.md), [ADR-0015](0015-testable-milestone-slices.md), [ADR-0016](0016-nestjs-fastify.md), [ADR-0017](0017-prisma-postgresql.md).

## Context

User meminta seluruh kode readable, newline/format konsisten, folder yang mempunyai tanggung jawab jelas, dan Clean Architecture. M0 awal menumpuk banyak route, query, validasi, dan UI pada file besar. Memasang Nest/Prisma atau menjalankan formatter saja tidak memperbaiki arah dependency.

## Decision

Gunakan **feature-oriented modular monolith dengan dependency mengarah ke dalam**. Backend module mempunyai `domain`, `application`, `infrastructure`, `presentation/http`; file `*.module.ts` menjadi composition root Nest untuk fitur tersebut. Shared dibatasi pada kebutuhan lintas fitur, bukan lokasi menumpuk semua service.

| Lapisan        | Boleh                                                                          | Tidak boleh                                                            |
| -------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| Domain         | Value/record, invariant, pure error dan types                                  | HTTP, ORM, Nest decorators, filesystem/network                         |
| Application    | Use case, port interface, domain, type-only shared DTO                         | Import runtime Nest/Fastify/Prisma, concrete repository, request/reply |
| Infrastructure | Implementasi repository, credential verifier, Zod policy, config dan client DB | Mengimpor HTTP controller untuk menjalankan aturan                     |
| Presentation   | Controller/guard/filter, transport parsing, presenter, use case/port           | Query DB atau instantiate concrete repository                          |
| Composition    | Menghubungkan interface ke implementasi melalui Nest providers                 | Mengambil alih aturan bisnis use case                                  |

Keputusan ini bukan kewajiban membuat empat file kosong untuk setiap operasi. Value sederhana tetap sederhana. Tidak memperkenalkan CQRS, event sourcing, microservice, generic BaseRepository, atau wrapper ORM yang tidak memiliki kebutuhan nyata.

Frontend menggunakan `app` untuk composition, `features` untuk halaman/hooks/components, dan `shared/api`, `shared/ui`, `shared/lib`. Feature tidak mengakses DB/Nest. Request client menangani transport, hooks menangani state, komponen menangani tampilan. Shared contracts dipisahkan menjadi schema, validation, fixtures, dan schema export tanpa mengubah API package yang sudah dipakai.

## Formatting dan otomatisasi

Konfigurasi Prettier milik user dipertahankan: 2 spasi, single quotes, semicolon, trailing commas, print width 80. `.editorconfig` menetapkan UTF-8/LF. `npm run format:check` memblokir format drift. Generated Prisma client dan exported contract JSON ditangani generator, bukan diperlakukan sebagai source manual; SQL migration yang sudah applied tidak diformat ulang untuk menghindari checksum drift.

ESLint menolak explicit `any`, unused imports, conditional tanpa braces, dan loose equality pada source yang dicakup konfigurasi. TypeScript strict/noUncheckedIndexedAccess mencakup source, test, serta tooling configs. Komentar menjelaskan invariant, alasan, atau failure case; bukan mengulang setiap baris kode.

`npm run architecture:check` membaca import graph TypeScript, memeriksa arah dependency, boundary browser/backend, dan runtime cycle, termasuk TSX/shared contracts. Test checker memuat import yang memang harus ditolak agar aturan tidak menjadi sekadar dokumen. Unit test use case memakai port doubles tanpa booting Nest; integration test memakai Nest/Fastify dan PostgreSQL nyata; E2E menguji flow FE/BE/DB.

Static checker adalah guardrail repository, bukan pembuktian seluruh bentuk dependency runtime. Alias/dynamic loading baru harus mempunyai resolver dan negative test; jangan memasukkannya sebagai bypass tersembunyi.

## Consequences

Jumlah file bertambah, tetapi perubahan tanggung jawab terlokalisasi dan use case dapat dibaca tanpa mengetahui transport/database. Ada biaya mapping serta factory wiring yang diterima; tidak memakai service locator global untuk menyembunyikannya. Ports diberi nama operasi aplikasi, bukan generic CRUD.

Dev startup menunggu API siap sebelum frontend terbuka. Backend dikompilasi TypeScript agar decorator metadata konsisten; restart dev command setelah perubahan backend/shared contracts. Frontend tetap memakai Vite HMR. Ini menghindari race compiler-watch yang dapat membuat halaman pertama gagal saat bootstrap.

## Verification dan evolution

Baseline harus lulus `format:check`, lint, dependency rules, source/test typecheck, contract tests, framework-free use-case tests, Prisma integration tests, generated-schema drift, build, docs links, dan browser tests. Bukti dicatat di [M0](../milestones/M0.md). Struktur nyata dan reading path: [CODE-STRUCTURE](../architecture/CODE-STRUCTURE.md).

Tidak ada label atau skor “standar FAANG” yang menggantikan evidence. Batas platform tidak berubah: M0 belum menjalankan AI dan belum siap deployment produksi. Setiap fase menambah kemampuan nyata FE/BE/DB tanpa kembali ke controller/query/UI monolitik.

## Configuration boundary

Runtime/tooling configuration follows the same explicit-boundary principle as code dependencies. M0 has one environment read boundary at `config/environment.mjs`; local `.env` and CI environment provide the values. Consumers receive validated config objects instead of reading arbitrary environment variables themselves.

Required configuration has no silent fallback. A new configurable setting must be declared in `.env.example`, validated in the canonical loader, documented in [CONFIGURATION](../development/CONFIGURATION.md), and covered by tests where correctness depends on it. Hidden JSON/YAML config or a second `DATABASE_URL` path is not allowed.
