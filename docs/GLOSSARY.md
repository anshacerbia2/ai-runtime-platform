# Glossary — Canonical Vocabulary

**Baseline 0.2.** Gunakan istilah ini pada API, diagram, ADR, dan test. English identifiers dipertahankan untuk konsistensi kontrak; penjelasan berbahasa Indonesia.

| Istilah                    | Arti                                                                   | Bukan berarti                                                |
| -------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------ |
| Application / app          | Pemilik workflow bisnis dan identitas pemanggil platform               | Satu runtime/provider                                        |
| Tenant                     | Scope organisasi/data yang diotorisasi                                 | Nilai body request yang otomatis dipercaya                   |
| Actor                      | Pengguna/service yang diotorisasi dalam scope app                      | Model/agent yang memberi dirinya izin                        |
| Business job / process     | Unit workflow aplikasi; process_id hanya correlation label di platform | Record job bisnis yang dikelola platform                     |
| Step                       | Tahap bisnis milik aplikasi yang membutuhkan AI                        | Setiap token atau internal model turn                        |
| Execution                  | Satu logical AI submission yang diterima platform                      | Keseluruhan job bisnis                                       |
| Attempt                    | Satu percobaan teknis execution; retry membuat attempt baru            | Logical operation tool baru                                  |
| Model invocation           | Satu actual call ke model/upstream yang dapat berbiaya                 | Selalu satu keseluruhan execution                            |
| Tool operation             | Maksud aksi logis dengan stable identity/digest                        | Identik dengan satu network retry                            |
| Operation invocation       | Satu pengiriman/percobaan tool operation                               | Izin untuk mengganti idempotency key                         |
| Capability                 | Kebutuhan seperti chat, structured_generate, agent_execute             | Nama vendor/model                                            |
| Provider adapter           | Integrasi API inference dan normalization                              | Agent runtime dengan loop/tools                              |
| Agent runtime              | Engine yang mengelola agent execution, tools, context/sessions         | Model API biasa                                              |
| Model policy               | Allowlist dan requirements model/schema/data                           | Satu nama runtime                                            |
| Credential binding         | Referensi secret/upstream identity yang diizinkan server               | Raw secret yang diberikan caller                             |
| Cognitive harness          | App-owned prompts, skills, templates, tool/schema knowledge            | Platform business workflow engine                            |
| Execution profile          | Immutable snapshot konfigurasi capability/runtime/model/harness/policy | Override permissions bebas di request                        |
| Managed Execution Envelope | Kontrak execution umum dengan runtime-specific capability limits       | Universal agent translator                                   |
| Authority / generation     | Durable hak assignment untuk commit state/result                       | Bukti bahwa proses remote pasti telah berhenti               |
| Lease                      | Temporary liveness/ownership proof untuk assignment                    | Permanent lock atau atomic transaction lintas storage        |
| Fencing                    | Penolakan stale generation setelah authority cutover                   | Pembatalan otomatis side effect yang sudah dikirim           |
| Coordination epoch         | Identity generasi coordination state setelah rebuild/failover          | Pengganti per-execution generation                           |
| Orphan quarantine          | Suspend/fence attempt yang kehilangan kepastian ownership              | Izin retry mutasi tanpa inquiry                              |
| Durable cancel intent      | Perintah cancel yang tetap ada walau sinyal hilang                     | Bukti provider sudah berhenti menagih                        |
| Reservation / hold         | Alokasi exposure sebelum dispatch                                      | Biaya aktual yang sudah lengkap                              |
| Usage observation          | Evidence pengukuran bersumber/berversi                                 | Financial truth tanpa validasi                               |
| Ledger entry               | Accepted charge/adjustment yang diaudit                                | Setiap token delta atau log metrics                          |
| Settlement                 | Pembukuan dan closure exposure berdasarkan evidence/policy             | Syarat semua result boleh diterima aplikasi                  |
| Reconciliation             | Mencocokkan evidence/outcome/charges yang belum pasti                  | Mengarang nol untuk menutup kasus                            |
| Cost basis                 | provider_reported, estimated, allocated, atau unknown                  | Angka yang selalu sama dengan invoice                        |
| Completeness               | Ukuran coverage measurement yang diketahui                             | Keaslian signature saja                                      |
| Replay cursor              | Opaque posisi stream yang scope/epoch-nya divalidasi                   | Auth token atau jaminan replay tak terbatas                  |
| Control event              | Durable lifecycle/audit fact                                           | Setiap live token delta                                      |
| Outbox                     | Durable delivery intent bersama transaction state                      | Exactly-once external effect                                 |
| Candidate artifact         | Output terunggah namun belum official result                           | Dokumen bisnis yang sudah dipublikasikan                     |
| Result manifest            | Daftar immutable output refs yang difinalisasi                         | Folder host arbitrary                                        |
| Runtime session            | Scope continuation same-runtime/version, single-writer                 | App conversation history atau cross-runtime memory universal |
| Acceptance gate            | Kriteria plus evidence implementasi sebelum cutover                    | Dokumen approval atau diagram yang berhasil render           |

Public status enums dan kombinasi valid: [EXECUTION-LIFECYCLE](contracts/EXECUTION-LIFECYCLE.md). Istilah status tambahan dari source principal dipetakan eksplisit di sana, bukan ditambahkan tanpa schema/version review.

## Registry and fleet terms

- **Application Registry** — durable identity/policy record untuk app consumer platform.
- **AI Connection** — logical provider/runtime account/project yang dapat memiliki banyak credential instances.
- **Credential Instance** — concrete auth material/reference untuk suatu AI Connection, central-managed atau runner-local.
- **Credential Binding** — authorization yang menghubungkan application/profile ke connection/credential scope.
- **Plugin Registry** — registry immutable versioned execution packages.
- **Runner Node / Pool** — execution node dan grouping untuk distributed placement.
- **Quota Group** — shared upstream rate-limit/budget authority untuk beberapa bindings dari account/project yang sama.
- **Workspace Mode** — `none`, `ephemeral`, atau `artifact_workspace` sesuai kebutuhan profile.
