# ADR-0030 — Encrypted durable dispatch envelope

**Tanggal:** 29 September 2026
**Status:** adopted; local storage/admission foundation implemented, production KMS and retention approval pending.
**Dasar:** [ADR-0003](0003-tiered-storage.md), [ADR-0007](0007-durable-accounting.md), [ADR-0012](0012-deployment-dispatch.md), O06 dan O14 pada [open decisions](../decisions/OPEN-QUESTIONS.md).

## Context

`agent_execute` membawa prompt dan referensi input yang harus bertahan melewati restart coordinator, tetapi raw input tidak boleh masuk ke execution row, outbox payload, log, trace attribute, atau object key. PostgreSQL dan object store tidak mempunyai transaksi bersama. Menaruh plaintext input di PostgreSQL akan memperluas blast radius, sedangkan memberi runner credential object-store akan melewati coordinator policy dan memperbesar credential surface.

Concrete production KMS/secret-manager dan kebijakan retention per data class belum dipilih. Implementasi lokal tetap harus membuktikan integrity, application isolation, lifecycle, retry, serta crash boundary tanpa menyamarkan test key sebagai production key management.

## Decision

Dispatch input memakai envelope encryption. Ciphertext disimpan pada S3-compatible object store dengan opaque UUID key. PostgreSQL hanya menyimpan application/execution/profile binding, input dan byte digests, ukuran, algorithm, wrapped data key, nonce, authentication tag, lifecycle, revision, dan timestamps. Plaintext serta plaintext data key tidak disimpan di PostgreSQL.

Cipher baseline adalah AES-256-GCM dengan random 96-bit nonce. Additional authenticated data mengikat version, envelope ID, application ID, intended execution ID, profile revision ID, dan canonical input digest. `KeyProvider` adalah port untuk generate/unwrap data key. Test memakai provider ephemeral di memory; mode production belum mempunyai fallback environment master key dan harus tetap blocked sampai adapter KMS/HSM yang dipilih melalui O14 tersedia.

Lifecycle authority adalah `STAGED -> COMMITTED -> CONSUMED -> DELETE_PENDING -> EXPIRED`, dengan `STAGED|CONSUMED -> DELETE_PENDING` ketika retention berakhir. Object di-upload dengan create-once semantics sebelum row `STAGED` dibuat. Kegagalan setelah upload dapat meninggalkan object tanpa row; bounded orphan sweeper menghapus object lama yang tidak direferensikan. Delete failure mempertahankan `DELETE_PENDING` agar sweep berikutnya dapat retry. Envelope `COMMITTED` yang kedaluwarsa tidak boleh didispatch atau dihapus oleh generic sweeper; future reconciliation harus menutup execution dan accounting authority terlebih dahulu.

Caller memilih UUID envelope dan intended execution sebelum upload. Admission mengunci staged envelope, memvalidasi application, `agent_execute` profile revision, canonical input digest, intended execution, state, dan expiry. Execution, attempt, reservations/outbox, dan promosi envelope ke `COMMITTED` terjadi dalam transaksi PostgreSQL yang sama. Rollback admission meninggalkan envelope `STAGED`; dispatcher kelak hanya boleh memilih `COMMITTED`. Semua expiry/CAS menggunakan clock PostgreSQL agar coordinator dengan clock berbeda tidak mengubah authority.

Implementasi menerima retention duration antara satu detik dan tujuh hari sebagai safety ceiling, bukan default atau persetujuan retention produksi. O06 tetap menentukan duration, legal hold, deletion, region, backup, dan ZDR untuk workload nyata. Runner tidak menerima object-store credential. Pull placement dan scoped metadata grant sekarang mengikuti [ADR-0031](0031-pull-dispatch-and-scoped-runner-grants.md); coordinator masih harus membaca, memverifikasi, membuka envelope dengan production KMS, dan meneruskan input melalui channel yang scoped.

## Alternatives considered

Raw prompt pada execution/outbox ditolak karena memperluas persistence dan observability exposure. Client-side direct S3 credential atau broad presigned URL ditolak karena melewati coordinator authorization dan sulit dicabut bersama fencing. Satu static AES key dari environment ditolak sebagai production key management. Database large-object tunggal tidak dipilih karena mencampur hot control/accounting path dengan payload retention. Distributed transaction PostgreSQL-object-store tidak diasumsikan tersedia.

## Consequences and trade-offs

Ada explicit cross-store repair path dan dua jenis sampah: object tanpa row serta row `DELETE_PENDING`. Ciphertext availability tidak memberi dispatch authority; row metadata tanpa object adalah corruption dan harus fail closed. KMS outage akan menghentikan dispatch baru/read, bukan membuka plaintext fallback. Object-store/KMS latency menjadi bagian dispatch SLO dan perlu circuit, retry, serta load evidence sebelum production.

Implementasi saat ini menyediakan migration 0014, cipher/ports, S3-compatible adapter, atomic admission promotion, lifecycle CAS, expiry/orphan GC primitive, unit/PostgreSQL tests, isolated MinIO conformance CI, serta autonomous initial placement dan scoped metadata grant. Belum ada public `agent_execute` route, payload delivery/decryption path, automatic reassignment, production KMS adapter, deletion worker scheduling, atau approved retention policy.

## Verification

Unit proof mencakup round-trip, AAD mismatch, ciphertext tamper, serta object-first orphan recovery. PostgreSQL proof mencakup failed binding tanpa execution, atomic admission promotion, replay, stale revision rejection, consume, idempotent expiry, locality-aware grant, dan concurrent claim deduplication. `npm run test:dispatch:s3` memeriksa create-once object key, ciphertext-only bytes, list/get/delete terhadap disposable MinIO.

## Revisit trigger

Revisit ketika O06/O14 memilih production retention dan KMS, ketika payload melebihi 1 MiB, ketika KMS/object-store latency membutuhkan cached data keys, atau ketika runner delivery topology memerlukan brokered streaming/presigned access. Perubahan tidak boleh memberi runner broad store credential atau memindahkan dispatch authority dari PostgreSQL.

Navigasi keputusan: [ADR index](README.md). Data model: [DATA-MODEL](../data/DATA-MODEL.md). Runtime status: [CURRENT-STATE](../implementation/CURRENT-STATE.md).
