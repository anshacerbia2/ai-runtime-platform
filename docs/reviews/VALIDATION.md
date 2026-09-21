# Documentation Validation Record

**Tanggal:** 20 September 2026 · **Baseline:** 0.2 · **Lingkup:** dokumentasi, bukan runtime implementation.

Bagian 1–4 mempertahankan hasil validasi baseline awal; bagian 5 merekam relokasi terdahulu. Hasil tersebut bukan klaim pengujian ulang saat pemeliharaan rujukan ADR pada bagian 6. Keputusan aktif dirujuk melalui [ADR](../adr/README.md).

## 1. Pemeriksaan baseline awal — catatan historis

| Check                | Recorded result                                                                        | Scope / limitation                                                             |
| -------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Markdown target set  | 51 authored files prepared: 3 existing source docs updated, 48 new docs                | Lingkup penulisan baseline saat itu                                            |
| Relative links       | 252 targets checked; 0 missing                                                         | Historical file-target check; not the current link count                       |
| UTF-8 encoding       | PASS: Unicode punctuation verified after readback                                      | Authored baseline Markdown stored as UTF-8 without BOM                         |
| Fenced code blocks   | Balanced in every authored document                                                    | Does not compile illustrative TypeScript/pseudocode                            |
| JSON examples        | 7 valid JSON examples                                                                  | Not an implemented API validator                                               |
| ADR structure        | 14 ADRs contain context, decision, alternatives, consequences, verification, evolution | Adopted design is not implementation proof                                     |
| Gate references      | G01–G25 references checked against catalogue                                           | All implementation gates NOT RUN                                               |
| Mermaid parse/render | 24 of 24 passed with Mermaid 11.12.2 and Chromium 144.0.7559.96                        | Historical offline render, not a guarantee of identical layout in every viewer |
| Visual spot-check    | Chat sequence, public-state flow, and ERD inspected                                    | Not a pixel-by-pixel review of every viewport                                  |
| Exact source match   | Diagram source manifest SHA-256 matched between remote draft and renderer              | Historical digest recorded below                                               |
| Local write/readback | PASS: 51 authored Markdown files written and SHA-256 readback matched                  | Baseline check, not a new hash check during reference maintenance              |
| Git publication      | Separate post-validation step, explicitly requested at the time                        | See repository history; runtime gates remain NOT RUN                           |

One Mermaid sequence label initially failed because its semicolon was interpreted as a statement separator. The label was corrected and all 24 diagrams were reparsed and rendered successfully. The successful baseline checks used installed Mermaid modules loaded in memory, without adding renderer dependencies to the user's repository. No fresh render is claimed by retaining this historical record.

## 2. Historical render source manifest

Combined ordered diagram source digest recorded at baseline:
`5c189ad1346c52c6b714fa9a8bb0196c6a37faeb50ab21e1e39e40d832f37ddc`.

| Document                                                                                   | Diagram index in file | Historical parse/render | Source SHA-256 prefix |
| ------------------------------------------------------------------------------------------ | --------------------- | ----------------------- | --------------------- |
| [ARCHITECTURE.md](../architecture/ARCHITECTURE.md)                                         | 1                     | PASS                    | `f8be6d7ea75584c2`    |
| [docs/diagrams/01-system-context.md](../diagrams/01-system-context.md)                     | 1                     | PASS                    | `255f6481a51d10e3`    |
| [docs/diagrams/01-system-context.md](../diagrams/01-system-context.md)                     | 2                     | PASS                    | `1b7f0c5a6b5c123c`    |
| [docs/diagrams/01-system-context.md](../diagrams/01-system-context.md)                     | 3                     | PASS                    | `36a492b2afbf020f`    |
| [docs/diagrams/02-direct-inference.md](../diagrams/02-direct-inference.md)                 | 1                     | PASS                    | `e558e098f62924ca`    |
| [docs/diagrams/02-direct-inference.md](../diagrams/02-direct-inference.md)                 | 2                     | PASS                    | `ba9c516b013a11b1`    |
| [docs/diagrams/03-agent-execution.md](../diagrams/03-agent-execution.md)                   | 1                     | PASS                    | `4353c6095e1fccf8`    |
| [docs/diagrams/03-agent-execution.md](../diagrams/03-agent-execution.md)                   | 2                     | PASS                    | `e01351ee99fa538c`    |
| [docs/diagrams/03-agent-execution.md](../diagrams/03-agent-execution.md)                   | 3                     | PASS                    | `0d64f04d994b9037`    |
| [docs/diagrams/04-recovery-cancellation.md](../diagrams/04-recovery-cancellation.md)       | 1                     | PASS                    | `13fc80f34c4e6899`    |
| [docs/diagrams/04-recovery-cancellation.md](../diagrams/04-recovery-cancellation.md)       | 2                     | PASS                    | `32324af362facafb`    |
| [docs/diagrams/04-recovery-cancellation.md](../diagrams/04-recovery-cancellation.md)       | 3                     | PASS                    | `ae0dfe8d4fd8f426`    |
| [docs/diagrams/04-recovery-cancellation.md](../diagrams/04-recovery-cancellation.md)       | 4                     | PASS                    | `4f0636467962e474`    |
| [docs/diagrams/05-budget-accounting.md](../diagrams/05-budget-accounting.md)               | 1                     | PASS                    | `baa6ffafeddc2a0a`    |
| [docs/diagrams/05-budget-accounting.md](../diagrams/05-budget-accounting.md)               | 2                     | PASS                    | `336ce531ad53066a`    |
| [docs/diagrams/05-budget-accounting.md](../diagrams/05-budget-accounting.md)               | 3                     | PASS                    | `f6f2c88ab382ec9e`    |
| [docs/diagrams/06-streaming-artifacts.md](../diagrams/06-streaming-artifacts.md)           | 1                     | PASS                    | `81b18a92d11c93dd`    |
| [docs/diagrams/06-streaming-artifacts.md](../diagrams/06-streaming-artifacts.md)           | 2                     | PASS                    | `9669ff301963db74`    |
| [docs/diagrams/06-streaming-artifacts.md](../diagrams/06-streaming-artifacts.md)           | 3                     | PASS                    | `a0d23be5ee32f65d`    |
| [docs/diagrams/07-deployment-data-security.md](../diagrams/07-deployment-data-security.md) | 1                     | PASS                    | `f4dd92810e14c30f`    |
| [docs/diagrams/07-deployment-data-security.md](../diagrams/07-deployment-data-security.md) | 2                     | PASS                    | `9e451fce228cc546`    |
| [docs/diagrams/07-deployment-data-security.md](../diagrams/07-deployment-data-security.md) | 3                     | PASS                    | `1a46db51f252e019`    |
| [docs/diagrams/08-evolution-migration.md](../diagrams/08-evolution-migration.md)           | 1                     | PASS                    | `ac067a6414e67617`    |
| [docs/diagrams/08-evolution-migration.md](../diagrams/08-evolution-migration.md)           | 2                     | PASS                    | `dafa005cc912b465`    |

## 3. Scope dan rujukan aktif

Baseline awal menggunakan Git commit `376d435bf43589784b1f1a5d76f88be33b233365` sebagai pembanding. Hash diagram di atas adalah catatan baseline, bukan pemeriksaan ulang file aktif. Keputusan saat ini dibaca dari [ADR](../adr/README.md); pemetaan ke spesifikasi/gate ada di [RECONCILIATION](RECONCILIATION.md), referensi pendukung di [SOURCES](SOURCES.md).

Only Markdown documentation is included in this change. Validation helpers and renderer dependencies were not added to the repository. Riwayat sumber yang telah dihapus tetap merupakan sejarah Git, bukan file yang harus tersedia untuk validasi atau navigasi aktif.

## 4. Checks not performed or not implied

M0 local FE/API/PostgreSQL code now exists and its evidence is recorded separately in [M0](../milestones/M0.md). No live provider/agent execution, production budget ledger, distributed runner fleet, plugin registry, Keycloak federation, secret-manager integration, load test, sandbox attack test, billing reconciliation, failover drill, deployment, atau production cutover has been demonstrated. G01–G35 remain **NOT RUN** as production gates. P3.5 remains blocked pending actual implementation evidence.

Relative-link and diagram validation does not certify contracts, compliance, capacity, timing SLOs, security containment, or financial completeness. [Open decisions](../decisions/OPEN-QUESTIONS.md) retain owner decisions and baseline review. Changing references to ADR does not grant approval of an unreviewed revision.

## 5. Relokasi dokumentasi — catatan historis, 20 September 2026

`PLAN.md`, `ROADMAP.md`, dan `CHANGELOG.md` dipindahkan ke `docs/`. `ARCHITECTURE.md` sudah dipindahkan oleh user ke `docs/architecture/ARCHITECTURE.md`; tautan masuk dan tautan relatif di dalamnya disesuaikan. README tetap di root.

Pada pemeriksaan relokasi terdahulu: 51 dokumen aktif dan satu sumber review historis tersedia; 252 tautan relatif diperiksa dengan kecocokan kapitalisasi, tanpa target hilang. Sebanyak 46 tujuan tautan disesuaikan. Fenced blocks, 24 diagram Mermaid, dan 7 contoh JSON tetap sama; JSON diparse ulang saat itu. Diagram tidak dirender ulang pada relokasi.

Sumber review historis masih dibiarkan utuh pada langkah relokasi tersebut dan kemudian dihapus oleh user. Pernyataan historis ini tidak menyatakan file tersebut masih tersedia sekarang. Pekerjaan relokasi tidak mengubah keputusan arsitektur, kontrak eksekusi, kode runtime, Git index, commit, atau push.

## 6. Pemeliharaan rujukan ADR — 20 September 2026

Rujukan keputusan aktif dipindahkan ke 14 ADR, dengan konteks mandiri, cross-reference, dan peta keputusan ke spesifikasi/gate. Sumber historis yang dihapus tidak dibuat ulang. Catatan integritas sumber yang tidak lagi tersedia tidak digunakan sebagai syarat validasi aktif. Audit penggunaan token tetap merupakan fungsi platform.

Pemeliharaan dilakukan melalui operasi baca/tulis file dan pencarian konten. Pemeriksaan scripted hash/link checker serta render ulang tidak dijalankan karena akses terminal tidak tersedia pada sesi ini. Hasil validasi baseline di bagian 1–5 tidak dipresentasikan sebagai pengujian baru. Tidak ada commit atau push pada pekerjaan ini.

Hasil pemeliharaan: 25 dokumen diperbarui. Pemindaian seluruh Markdown terhadap nama sumber review yang dihapus, identifier sumber lama, dan frasa navigasi lama menghasilkan 0 kecocokan. Readback README, indeks ADR, arsitektur, bagian akhir plan, dan catatan validasi mengonfirmasi struktur utuh. Target ADR pada navigasi cocok dengan file yang tersedia. Pemeriksaan ini tidak menggantikan automated link checker, hash verification, atau runtime gate.

## 7. Pemeriksaan sebelum commit reorganisasi ADR

51 dokumen Markdown dan 360 tautan relatif diperiksa ulang melalui terminal: tidak ada target hilang atau rujukan ke file review yang sudah dihapus. Fenced blocks seimbang. Pemeriksaan ini menggantikan keterbatasan akses terminal pada langkah sebelumnya, bukan klaim pengujian runtime atau render ulang.

## 8. Implementasi M0 lokal

Catatan baseline dokumentasi di atas bersifat historis. M0 sekarang menambahkan kode FE/BE, PostgreSQL, schema export dan tests. Hasil aktual dan batas verifikasi ada pada [milestone M0](../milestones/M0.md). Tes runtime/platform produksi tetap NOT RUN; lokal Contract Lab tidak mengesahkan implementasi gateway, agent, financial ledger atau sandbox.

## Refactor NestJS/Fastify/Prisma

Pemeriksaan source, dependency, database, migration, dan browser terbaru dicatat di [M0 refactor evidence](../milestones/M0.md). Hasil baseline sebelumnya tetap historis; belum ada load test SSE, provider smoke, atau deployment produksi. Rujukan keputusan terbaru: [ADR-0016](../adr/0016-nestjs-fastify.md), [ADR-0017](../adr/0017-prisma-postgresql.md), dan [ADR-0018](../adr/0018-clean-architecture-quality.md).

## 9. Platform-control/fleet synchronization — 21 September 2026

ADR-0019–ADR-0022, Control Plane contract, distributed-runner diagram, architecture/boundaries, API/profile/plugin/artifact contracts, data/accounting/security/reliability/deployment/runbooks, acceptance gates, migration, PLAN, ROADMAP, glossary/index/changelog, dan M0 scope notes were synchronized for the new requirements.

Current automated documentation check: **64 Markdown files, 489 local links, 0 missing file targets**. Repository-wide Prettier check also passed after synchronization.

Production gates now span **G01–G35**. G26–G35 cover application/connection isolation, secret handling, dedicated/shared connection semantics, runner registration/lifecycle, runner-local credential locality, shared quota groups, plugin supply-chain checks, optional workspace containment, optional remote-tool/MCP semantics, and fleet failover/fencing. These gates remain NOT RUN until the corresponding implementation exists.

No claim is made that M0 implements Keycloak federation, Admin control-plane management, AI Connection/Credential Binding, Plugin Registry, distributed runner placement, Vault integration, remote MCP tools, or production workspace/artifact promotion.
