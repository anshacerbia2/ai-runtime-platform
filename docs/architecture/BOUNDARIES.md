# Batas Produk, Actor, dan Kepemilikan

**Rancangan baseline 0.2.** Dasar: kebutuhan user dalam percakapan serta [Architecture](../../ARCHITECTURE.md). Mapping aplikasi di bawah adalah target integrasi, bukan klaim bahwa repo aplikasi sudah dimigrasikan.

## Actor dan authority

| Actor | Boleh | Tidak boleh |
| --- | --- | --- |
| App backend/service | Submit sesuai profile, baca/cancel execution miliknya, baca usage/artifact scope-nya | Memalsukan tenant, memilih secret arbitrary, mengubah ledger |
| Chat UI | Mengirim melalui BFF; alternatif delegated token sempit | Menyimpan service/provider key |
| Profile owner (app/team) | Versioning cognitive harness, input/output schemas, acceptance criteria | Memperluas sandbox permission sendiri tanpa policy approval |
| Platform operator | Mengelola rollout, budgets, runtime availability, recovery | Mengubah outcome bisnis atau membuang evidence untuk membuat angka tampak baik |
| Worker/sandbox | Menjalankan satu assigned attempt sesuai grants | Akses database/control-plane secret, membuat generation baru, menaikkan izin |
| Usage verifier | Verifikasi evidence, normalisasi, dedup, settlement/adjustment | Memulihkan authority worker atau mengganti result |
| Security/accounting reviewer | Menyetujui scoped deployment/data/accounting controls | Menganggap sign-off desain sebagai test pass |

## App patterns

| App/pola | Input ke platform | Output platform | Tetap di app |
| --- | --- | --- | --- |
| Scribe | Prompt atau input/artifact refs, process/job ID, step, profile/plugin version | Artifact manifest, execution state/events, usage | Job lifecycle, document validation, review, publish |
| Farexlate | Satu batch/tahap translate, verify, atau repair dengan schema/context | Structured/text result, usage per step/attempt | Sequencing, glossary, translation memory, quality rules |
| Themis/sq-fare | Request interpretasi yang dibatasi schema | Result dan source/request metadata | Fare rules, enum/domain/evidence validation |
| RAGnosis/ragnarok | Selected model call + context yang telah diotorisasi | Model result/stream, usage | Retrieval, ACL dokumen, SQL, citation validation, index version |
| Future chat | Messages + optional conversation ID + profile | Streaming response/result/status/usage | UI, conversation ownership, user consent/history policy |

Platform tidak perlu mengenal nama job bisnis atau status seperti document-approved. Correlation IDs diperlakukan sebagai label opaque, bukan foreign key ke database aplikasi.

## Identitas dan tenancy

`application_id` berasal dari service principal; `tenant_id` dari authorized binding/claim. `actor_ref` opsional untuk attribution delegated-user, hanya dari token/claim terpercaya. Scope minimal mencakup submit, read-own, cancel-own, read-artifact, read-usage. Admin profile/credential/ledger scopes terpisah.

Aplikasi tidak boleh membaca execution aplikasi lain hanya karena berbagi tenant. Cross-app sharing memerlukan explicit grant. Kebijakan tenant/session/artifact/usage ditegakkan pada setiap read, list, stream, cancel, dan object grant. Cache key mencakup tenant/application dan authorization scope; shared semantic cache tidak aktif pada MVP.

## Hubungan dengan platform organisasi lain

Repository lain tidak otomatis menjadi dependency runtime hanya karena ada di folder yang sama. Adapter identitas dapat memakai identity platform organisasi bila kontrak/auth service tersedia; jangan membangun IdP baru. Organization context diterima sebagai validated claims, bukan menyalin seluruh domain organization.

Scheduling bisnis tetap di aplikasi/scheduling platform. Retry/backoff/lease reconciliation internal adalah mekanisme eksekusi, bukan penjadwalan bisnis. Notification produk tetap di app/notification platform; baseline AI Runtime menyediakan status/SSE, tidak menambahkan notification engine. Foundation observability/idempotency package dapat direuse setelah contract review, tidak diasumsikan kompatibel.

## Dua orchestration yang berbeda

App orchestration menentukan langkah bisnis berikutnya (translate -> verify -> repair atau generate -> review -> publish). Runtime agent loop memilih tool/langkah teknis di dalam execution yang diizinkan profile. Approval untuk tool mutasi tetap berasal dari authority aplikasi/pengguna; model output tidak dapat memberi dirinya sendiri izin.

## Control plane versus data plane

Control plane menyimpan policy, assignment, status, reservation, audit. Gateway/sandbox menangani model IO/compute. Worker hanya boleh melaporkan proposal hasil dan evidence; service berwenang melakukan durable commit. SSE adalah presentasi data, bukan jalur command. Direct provider access oleh app merupakan pengecualian migrasi yang harus didokumentasikan, bukan target steady-state.

Diagram terkait: [context/container](../diagrams/01-system-context.md), [agent flow](../diagrams/03-agent-execution.md), [deployment/trust](../diagrams/07-deployment-data-security.md).
