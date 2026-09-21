# Batas Produk, Actor, dan Kepemilikan

**Rancangan baseline 0.2.** Dasar: kebutuhan user dalam percakapan serta [Architecture](ARCHITECTURE.md). Mapping aplikasi di bawah adalah target integrasi, bukan klaim bahwa repo aplikasi sudah dimigrasikan.

## Actor dan authority

| Actor                        | Boleh                                                                                | Tidak boleh                                                                    |
| ---------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| App backend/service          | Submit sesuai profile, baca/cancel execution miliknya, baca usage/artifact scope-nya | Memalsukan application scope, memilih secret arbitrary, mengubah ledger        |
| Chat UI                      | Mengirim melalui BFF; alternatif delegated token sempit                              | Menyimpan service/provider key                                                 |
| Profile owner (app/team)     | Versioning cognitive harness, input/output schemas, acceptance criteria              | Memperluas sandbox permission sendiri tanpa policy approval                    |
| Platform operator            | Mengelola rollout, budgets, runtime availability, recovery                           | Mengubah outcome bisnis atau membuang evidence untuk membuat angka tampak baik |
| Worker/sandbox               | Menjalankan satu assigned attempt sesuai grants                                      | Akses database/control-plane secret, membuat generation baru, menaikkan izin   |
| Usage verifier               | Verifikasi evidence, normalisasi, dedup, settlement/adjustment                       | Memulihkan authority worker atau mengganti result                              |
| Security/accounting reviewer | Menyetujui scoped deployment/data/accounting controls                                | Menganggap sign-off desain sebagai test pass                                   |

## App patterns

| App/pola          | Input ke platform                                                             | Output platform                                  | Tetap di app                                                    |
| ----------------- | ----------------------------------------------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------- |
| Scribe            | Prompt atau input/artifact refs, process/job ID, step, profile/plugin version | Artifact manifest, execution state/events, usage | Job lifecycle, document validation, review, publish             |
| Farexlate         | Satu batch/tahap translate, verify, atau repair dengan schema/context         | Structured/text result, usage per step/attempt   | Sequencing, glossary, translation memory, quality rules         |
| Themis/sq-fare    | Request interpretasi yang dibatasi schema                                     | Result dan source/request metadata               | Fare rules, enum/domain/evidence validation                     |
| RAGnosis/ragnarok | Selected model call + context yang telah diotorisasi                          | Model result/stream, usage                       | Retrieval, ACL dokumen, SQL, citation validation, index version |
| Future chat       | Messages + optional conversation ID + profile                                 | Streaming response/result/status/usage           | UI, conversation ownership, user consent/history policy         |

Platform tidak perlu mengenal nama job bisnis atau status seperti document-approved. Correlation IDs diperlakukan sebagai label opaque, bukan foreign key ke database aplikasi.

## Identitas dan application scope

`application_id` berasal dari authenticated service principal/client binding. `actor_ref` opsional untuk attribution delegated-user dan hanya berasal dari token/claim terpercaya. Scope minimal mencakup submit, read-own, cancel-own, read-artifact, dan read-usage. Admin profile/credential/ledger scopes terpisah.

Aplikasi tidak boleh membaca resource aplikasi lain tanpa explicit cross-app grant. Application/session/artifact/usage policy ditegakkan pada setiap read, list, stream, cancel, dan object grant. Cache key mencakup application dan authorization scope; shared semantic cache tidak aktif pada MVP.

Saat ini deployment diasumsikan berada dalam satu organisasi, sehingga Organization/Tenant bukan runtime authority atau required contract field. Jika kelak dibutuhkan multi-organization, parent scope diperkenalkan melalui versioned architecture/data migration tanpa mengubah ownership Application hari ini.

## Hubungan dengan platform lain

Repository lain tidak otomatis menjadi dependency runtime hanya karena ada di folder yang sama. Identity integration memakai Keycloak/ATI One contract yang ditetapkan untuk aplikasi ini; platform tidak membangun IdP baru.

Scheduling bisnis tetap di aplikasi/scheduling platform. Retry/backoff/lease reconciliation internal adalah mekanisme eksekusi, bukan penjadwalan bisnis. Notification produk tetap di app/notification platform; baseline AI Runtime menyediakan status/SSE, tidak menambahkan notification engine. Foundation observability/idempotency package dapat direuse setelah contract review, tidak diasumsikan kompatibel.

## Dua orchestration yang berbeda

App orchestration menentukan langkah bisnis berikutnya (translate -> verify -> repair atau generate -> review -> publish). Runtime agent loop memilih tool/langkah teknis di dalam execution yang diizinkan profile. Approval untuk tool mutasi tetap berasal dari authority aplikasi/pengguna; model output tidak dapat memberi dirinya sendiri izin.

## Control plane versus data plane

Control plane menyimpan policy, assignment, status, reservation, audit. Gateway/sandbox menangani model IO/compute. Worker hanya boleh melaporkan proposal hasil dan evidence; service berwenang melakukan durable commit. SSE adalah presentasi data, bukan jalur command. Direct provider access oleh app merupakan pengecualian migrasi yang harus didokumentasikan, bukan target steady-state.

Diagram terkait: [context/container](../diagrams/01-system-context.md), [agent flow](../diagrams/03-agent-execution.md), [deployment/trust](../diagrams/07-deployment-data-security.md).

## Application, connection, plugin, dan runner boundaries

- **Application Registry** menentukan application identity, environment, allowed profiles/connections/plugins, dan policy scope.
- **Keycloak** membuktikan siapa caller; ia tidak menentukan provider credential yang dipakai platform.
- **AI Connection Registry** merepresentasikan logical provider/runtime account/project. Secret material berada di secret manager atau runner-local store.
- **Credential Binding** mengizinkan connection untuk application/profile tertentu. Dedicated adalah default aman; shared connection membutuhkan explicit allow-list.
- **Plugin package** boleh dimiliki team aplikasi tetapi hanya dieksekusi pada execution-plane sandbox. Control plane tidak menjalankan arbitrary plugin.
- **Remote tool** tetap dimiliki service/domain asal dan dapat diakses via MCP atau typed HTTP/RPC; MCP bukan kewajiban semua app.
- **Runner** adalah execution node, bukan owner workflow. Runner boleh memiliki local credentials/capabilities berbeda, dan logical AI account yang sama boleh tersedia pada banyak runner.
