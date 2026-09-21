# ADR-0017 — Prisma dan PostgreSQL pada persistence boundary

**Tanggal:** 21 September 2026

**Status:** adopted; repository M0 memakai Prisma, bukan query SQL di controller.

**Keputusan terkait:** [ADR-0007](0007-durable-accounting.md), [ADR-0016](0016-nestjs-fastify.md), [ADR-0018](0018-clean-architecture-quality.md).

## Context

User meminta ORM dan fondasi persistence yang readable, typed, serta terpisah dari HTTP. M0 sudah memiliki data PostgreSQL, migration SQL, unique constraints, dan idempotency semantics. Mengganti teknologi akses data tidak boleh mereset riwayat atau menganggap concurrency correctness otomatis disediakan ORM.

## Decision

Gunakan **Prisma ORM 7.10.0** dengan `@prisma/client` dan `@prisma/adapter-pg` versi sama, PostgreSQL sebagai durable datastore. Prisma 7 membutuhkan driver adapter; `pg` tetap merupakan driver di bawah PrismaPg, bukan competing application repository.[^driver]

Schema di `prisma/schema.prisma`; Prisma Migrate di `prisma/migrations/`; generated client berada di infrastructure API dan tidak di-commit. Semua versi dipin dalam package-lock. Versi CLI release-candidate 8 yang muncul saat pemeriksaan registry tidak dipakai otomatis. Major stack dipilih eksplisit; update harus melewati verification.

Port repository dimiliki application layer, implementasinya menggunakan Prisma di infrastructure. Tidak ada Prisma model, transaction client, HTTP request, atau Nest decorator yang bocor ke use case/domain. Mapper mengembalikan plain records; satu client/pool per API process dikelola Nest lifecycle. CLI/test membuka dan menutup client miliknya sendiri.

## Transaksi dan SQL khusus

M0 menggunakan unique constraint `(application_id, idempotency_key)` dan transaksi create-or-read. Same key/same digest menjadi replay; digest berbeda menjadi conflict. Rejected/conflicting request tidak diklaim execution baru. Transaction timeout/pool dibatasi; tidak ada network provider call di dalam database transaction.

Prisma mendukung interactive transactions dan pemilihan isolation level. Serializable dapat menghasilkan write conflict yang perlu kebijakan retry terbatas; bukan izin retry side effect eksternal.[^transactions] Untuk operasi M1 seperti row locking/accounting, parameterized raw SQL boleh berada di persistence adapter ketika API ORM tidak cukup. Hindari interpolasi identifier/untrusted SQL dan raw-unsafe string concatenation.[^raw]

Tidak membuat generic BaseRepository atau membungkus semua metode Prisma satu-per-satu. Port menyatakan operasi aplikasi yang diperlukan, termasuk batas atomic save. ORM tidak menggantikan DB constraints, authorization scope, dedup, budget conservation, dan failure tests pada ADR-0007.

## Migrasi data yang sudah ada

Sebelum perubahan dibuat backup source dan `pg_dump` lokal yang Git-ignored. SQL legacy `db/migrations/0001_m0_contract_lab.sql` dipertahankan byte-for-byte karena sudah mempunyai checksum.

Bootstrap memverifikasi checksum dan schema diff database yang ada, baru menandai `0001_baseline` applied melalui `prisma migrate resolve`. Setelah itu `migrate deploy` dan seed idempotent. Database kosong memakai migration yang sama; custom CHECK constraints disimpan dalam migration SQL. **Tidak menjalankan reset, drop schema, atau db push untuk memaksakan kecocokan.** Baselining memang disediakan untuk database existing yang datanya perlu dipertahankan.[^baseline]

Schema diff ORM tidak membuktikan semua fitur SQL custom, karena sebagian constraint tidak diwakili Prisma schema. Karena itu migration SQL tetap direview, checksum legacy diperiksa, dan constraint diuji langsung pada integration suite. Penambahan schema berikutnya harus migration baru, bukan menulis ulang history.

## Alternatives considered

`pg` + SQL langsung memberi kontrol lengkap, tetapi mapping/types/query boilerplate dibangun sendiri; tetap dipakai hanya untuk administrasi lokal sebelum Prisma tersedia. ORM lain seperti TypeORM/Drizzle bukan requirement proyek saat ini; tidak menambah dua ORM untuk fungsi sama. Pilihan Prisma didasarkan pada typed client, schema workflow, dan boundary yang eksplisit, bukan klaim lebih cepat atau bebas bug dari semua alternatif.

## Dependency security dan trade-off

Pemeriksaan install menemukan advisory pada dependency CLI Prisma. Dipasang override **terbatas** `@prisma/config -> deepmerge-ts 8.0.2` dan `prisma -> mysql2 3.24.4`, lalu generate/config loading/migrate/seed dan suite dijalankan ulang. Ini bukan `npm audit fix --force`; tidak menambahkan MySQL sebagai runtime datastore. Override deepmerge lintas-major menambah compatibility risk dan harus ditinjau pada update CLI. Hapus override ketika upstream sudah memasok versi fixed yang kompatibel.[^deepmerge][^mysql]

Audit dependency mengukur advisory yang diketahui pada saat command dijalankan, bukan sertifikasi keamanan. Pool sizing, privilege role, backup restore, patch PostgreSQL, dan accounting capacity perlu production review terpisah. PostgreSQL 15.5 yang terpasang di workstation bukan patch version yang direkomendasikan untuk produksi. Credential bootstrap/runtime M0 masih lokal; pemisahan role migrator dan runtime wajib sebelum deployment nonlokal.

## Verification dan evolution

Uji real DB: persistence/replay/conflict, 20 duplicate requests serentak, cross-app isolation, raw prompt tidak tersimpan, cursor microsecond, migration replay, client restart, serta legacy-row preservation. M1 settlement/concurrency/fencing belum dianggap implemented. Revisit persistence strategy jika query/locking/workload terukur mengharuskan perubahan, dengan ports tetap stabil dan migration rollback/restore plan.

[^driver]: [Prisma — ORM 7 setup](https://www.prisma.io/docs), bagian Prisma ORM 7 dan driver adapter.

[^transactions]: [Prisma 7 — Transactions](https://docs.prisma.io/docs/orm/v7/prisma-client/queries/transactions).

[^raw]: [Prisma — Raw queries](https://www.prisma.io/docs/orm/v6/prisma-client/using-raw-sql/raw-queries), rujukan tagged parameterization; API yang digunakan juga harus cocok dengan client 7 yang dipin.

[^baseline]: [Prisma — Baselining](https://www.prisma.io/docs/orm/prisma-migrate/workflows/baselining) dan [CLI 7 migrate](https://docs.prisma.io/docs/cli/v7/migrate).

[^deepmerge]: [Maintainer advisory GHSA-ggr8-5vv4-36mx](https://github.com/RebeccaStevens/deepmerge-ts/security/advisories/GHSA-ggr8-5vv4-36mx).

[^mysql]: [GHSA-3f6p-5ww8-9rcr](https://github.com/advisories/GHSA-3f6p-5ww8-9rcr) dan [GHSA-rgwj-5xj2-c3m3](https://github.com/advisories/GHSA-rgwj-5xj2-c3m3); dependency transitive CLI, bukan runtime database pilihan.
