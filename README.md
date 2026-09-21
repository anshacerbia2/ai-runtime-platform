# AI Runtime Platform

Shared AI execution platform untuk aplikasi yang membutuhkan direct chat, structured inference, atau agent/tools. **App owns business workflow; platform owns AI execution.**

**M0 Contract Lab · 0.3.0-m0.** Frontend, backend, dan PostgreSQL lokal tersedia untuk mencoba kontrak dan menyimpan riwayat validasi. Belum ada panggilan AI, agent, atau billing. Arsitektur target tetap baseline 0.2; M1 dan fase berikutnya belum diimplementasikan.

**Fixed implementation stack:** NestJS + Fastify HTTP adapter + Prisma + PostgreSQL; frontend React/TypeScript + Vite. Struktur dan aturan dependency: [CODE-STRUCTURE](docs/architecture/CODE-STRUCTURE.md). Keputusan stack: [ADR-0016](docs/adr/0016-nestjs-fastify.md)–[ADR-0018](docs/adr/0018-clean-architecture-quality.md). Platform-control/fleet decisions: [ADR-0019](docs/adr/0019-application-connections-credentials.md)–[ADR-0022](docs/adr/0022-distributed-runner-fleet.md). Stack sudah diterapkan pada M0; fitur produksi tetap mengikuti gate.

## Coba lokal

```powershell
npm ci
npm run dev
```

Buka `http://127.0.0.1:4310`. Node 24 dan PostgreSQL binaries diperlukan; bootstrap memakai cluster khusus proyek ini. [Panduan M0](docs/development/M0.md) menjelaskan port, database, cara uji, dan penghentian. [Status/evidence M0](docs/milestones/M0.md) memisahkan slice teknis dari review kontrak yang masih terbuka.

## Mulai membaca

| Kebutuhan                                         | Dokumen                                                   |
| ------------------------------------------------- | --------------------------------------------------------- |
| Konsep, boundary, komponen, invariant             | [ARCHITECTURE.md](docs/architecture/ARCHITECTURE.md)      |
| Urutan implementasi dan gate                      | [PLAN.md](docs/PLAN.md) dan [ROADMAP.md](docs/ROADMAP.md) |
| Kontrak integrasi aplikasi                        | [API](docs/contracts/API.md)                              |
| Seluruh dokumen dan reading paths                 | [Documentation index](docs/INDEX.md)                      |
| Visual alur normal dan kegagalan                  | [Diagram catalogue](docs/diagrams/README.md)              |
| Keputusan arsitektur, alternatif, dan konsekuensi | [22 ADR](docs/adr/README.md)                              |
| Pemetaan keputusan ke spesifikasi dan pengujian   | [Decision traceability](docs/reviews/RECONCILIATION.md)   |
| Pengujian produksi yang masih harus dibuktikan    | [Acceptance gates](docs/testing/ACCEPTANCE.md)            |

Dokumen perencanaan dan changelog berada di `docs/`; arsitektur utama berada di `docs/architecture/ARCHITECTURE.md`. `README.md` tetap menjadi pintu masuk repository.

## Mental model

```text
Application
  | prompt/input + profile + optional process/step
  v
AI Runtime Platform
  +-- Control Plane: apps, profiles, AI connections, plugins, runner fleet
  +-- Model Gateway: OpenRouter and direct adapter
  +-- Agent Runtime: Claude, later Codex and Gemini
  +-- Distributed workers: placement, sandbox, optional workspace/plugin
  +-- Result, events, usage, policy, and audit
  |
  v
Application decides the next business step
```

Direct chat tidak membutuhkan business job atau plugin. Execution ID dan authenticated app identity tetap tersedia. Model, provider, agent runtime, credential binding, dan app-owned harness adalah konsep terpisah.

## Baseline choices

OpenRouter-first dengan pembuktian Direct Anthropic adapter pada Phase 2; primary route ditentukan profile. Claude adalah runtime awal. Managed Execution Envelope menormalkan lifecycle, bukan menjanjikan semua agent identik. Tiered storage memisahkan durable PostgreSQL state/accounting, Redis heartbeat/replay, dan object artifacts.

Completion tidak menunggu settlement. Reservasi durable dibuat sebelum dispatch; penolakan tidak mengurangi saldo. Lease renewal tidak membangkitkan key yang hilang. Late usage dapat direkonsiliasi tanpa memberi worker lama authority kembali. Stateful tool retry memerlukan receiver-supported operation key/status semantics.

## Status dan otoritas dokumentasi

[ADR](docs/adr/README.md) menjadi rujukan keputusan arsitektur yang aktif. Kontrak dan spesifikasi merinci pelaksanaannya; [decision traceability](docs/reviews/RECONCILIATION.md) memetakan keputusan ke dokumen dan gate. Riwayat review tersimpan dalam Git, bukan prasyarat membaca desain saat ini. [Open decisions](docs/decisions/OPEN-QUESTIONS.md) mencatat requirement deployment/data/credential/SLO dan review yang belum selesai.

Document checks dilaporkan di [VALIDATION](docs/reviews/VALIDATION.md). Gate G01–G25 adalah requirement pengujian masa implementasi dan belum dijalankan; rendering diagram bukan bukti distributed-system correctness. Riwayat perubahan: [CHANGELOG](docs/CHANGELOG.md).
