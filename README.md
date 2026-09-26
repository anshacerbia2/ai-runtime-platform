# AI Runtime Platform

Shared AI execution platform untuk aplikasi yang membutuhkan direct chat, structured inference, atau agent/tools. **App owns business workflow; platform owns AI execution.**

**M0–M2 sekarang LOCAL IMPLEMENTATION COMPLETE.** Contract Lab tetap runnable; M1 durable foundation mencakup identity/control plane/admission/accounting/runner-authority kernel; M2 menyediakan local model gateway untuk `chat`, `generate`, dan `structured_generate` dengan OpenRouter + Direct Anthropic adapters, bounded SSE/replay, structured-output validation, safe fallback, capacity/rate limits, durable result, dan usage/accounting evidence. Authorized live vendor smoke, live ATI Keycloak/deployed Redis/secret-manager, M3 agent runtime, dan production readiness tetap pending. Arsitektur target tetap baseline 0.2 plus adopted extensions.

**Fixed implementation stack:** NestJS + Fastify HTTP adapter + Prisma + PostgreSQL; frontend React/TypeScript + Next.js App Router dengan BFF tier. Struktur dan aturan dependency: [CODE-STRUCTURE](docs/architecture/CODE-STRUCTURE.md). Keputusan stack: [ADR-0016](docs/adr/0016-nestjs-fastify.md)–[ADR-0018](docs/adr/0018-clean-architecture-quality.md) dan [ADR-0026](docs/adr/0026-nextjs-bff.md). Web delivery/auth: [ADR-0025](docs/adr/0025-external-app-standalone-auth.md). Platform-control/fleet decisions: [ADR-0019](docs/adr/0019-application-connections-credentials.md)–[ADR-0022](docs/adr/0022-distributed-runner-fleet.md). Backend stack sudah diterapkan pada M0; migrasi web ke Next.js App Router/BFF sudah diimplementasikan, dengan opaque session cookie, server-side token custody, dan server-rendered docs. Fitur produksi tetap mengikuti gate.

## Kondisi source saat ini

M0–M2 sudah mencakup hardening HTTP/UI dan perluasan [ADR-0027–0029](docs/adr/README.md): resource APIs `/api/v1`, independent pagination/count overview, atomic management receipts dengan optimistic concurrency, bounded client retry, machine-only runner authority/fencing, quarantine evidence, explicit mappers/serialization CI gate, serta executable model gateway dengan durable provider invocation/result dan accounting. Autonomous runner dispatch/agent runtime belum ada; authorized live OpenRouter/Anthropic smoke dan production deployment belum dibuktikan.

Mulai dari [kondisi implementasi aktual](docs/implementation/CURRENT-STATE.md), [katalog operasi HTTP aktif](docs/implementation/HTTP-API.md), dan [diagram implementasi](docs/diagrams/10-implemented-contracts.md). Rancangan target, fitur PLANNED, dan hasil tes historis tetap dibedakan. Source dan migration adalah rujukan perilaku saat ini; status verifikasi terbaru ada di [contract execution evidence](docs/reviews/CONTRACT-EXECUTION.md), sementara [documentation sync](docs/reviews/DOCUMENTATION-SYNC.md) tetap menjadi snapshot audit 24 September.

## Coba lokal

```powershell
npm ci
npm run env:init
# Untuk checkout lama: jangan overwrite .env; tambahkan variable baru dari .env.example.
# review .env
npm run dev
```

Alamat FE/API, PostgreSQL, browser-test settings, credentials, dan timeout berasal dari root `.env`; M0 tidak memakai hidden local config atau silent fallback. Node 24 dan PostgreSQL binaries diperlukan bila `M0_MANAGE_POSTGRES=true`. [Panduan M0](docs/development/M0.md) menjelaskan cara uji; [Web/BFF Operations](docs/development/WEB.md) menjelaskan entry, session, dan deployment Next.js; [Configuration](docs/development/CONFIGURATION.md) mendefinisikan single env gate; [Status/evidence M0](docs/milestones/M0.md) memisahkan slice teknis dari review kontrak yang masih terbuka.

## Mulai membaca

| Kebutuhan                                         | Dokumen                                                   |
| ------------------------------------------------- | --------------------------------------------------------- |
| Konsep, boundary, komponen, invariant             | [ARCHITECTURE.md](docs/architecture/ARCHITECTURE.md)      |
| Frontend, external-app delivery, BFF, CDD, token  | [FRONTEND.md](docs/architecture/FRONTEND.md)              |
| Urutan implementasi dan gate                      | [PLAN.md](docs/PLAN.md) dan [ROADMAP.md](docs/ROADMAP.md) |
| Kontrak integrasi aplikasi                        | [API](docs/contracts/API.md)                              |
| Seluruh dokumen dan reading paths                 | [Documentation index](docs/INDEX.md)                      |
| Visual alur normal dan kegagalan                  | [Diagram catalogue](docs/diagrams/README.md)              |
| Keputusan arsitektur, alternatif, dan konsekuensi | [29 ADR](docs/adr/README.md)                              |
| Pemetaan keputusan ke spesifikasi dan pengujian   | [Decision traceability](docs/reviews/RECONCILIATION.md)   |
| Pengujian produksi yang masih harus dibuktikan    | [Acceptance gates](docs/testing/ACCEPTANCE.md)            |

Dokumen perencanaan dan changelog berada di `docs/`; arsitektur utama berada di `docs/architecture/ARCHITECTURE.md`. `README.md` tetap menjadi pintu masuk repository.

## Mental model produk target (bukan seluruhnya aktif)

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

Direct chat tidak membutuhkan business job atau plugin. Public capability baseline adalah `chat`, `generate`, `structured_generate`, dan `agent_execute`; lihat [Capability Catalogue](docs/contracts/CAPABILITIES.md). Execution ID dan authenticated app identity tetap tersedia. Model, provider, agent runtime, credential binding, dan app-owned harness adalah konsep terpisah.

## Execution-plane choices

M2 sudah mengimplementasikan OpenRouter + Direct Anthropic adapters secara lokal; primary/fallback route ditentukan immutable profile policy. Claude adalah runtime awal. Managed Execution Envelope menormalkan lifecycle, bukan menjanjikan semua agent identik. Tiered storage memisahkan durable PostgreSQL state/accounting, Redis heartbeat/replay, dan object artifacts.

Completion tidak menunggu settlement. Reservasi durable dibuat sebelum dispatch; penolakan tidak mengurangi saldo. Lease renewal tidak membangkitkan key yang hilang. Late usage dapat direkonsiliasi tanpa memberi worker lama authority kembali. Stateful tool retry memerlukan receiver-supported operation key/status semantics.

## Status dan otoritas dokumentasi

[ADR](docs/adr/README.md) menjadi rujukan keputusan arsitektur yang aktif. Kontrak dan spesifikasi merinci pelaksanaannya; [decision traceability](docs/reviews/RECONCILIATION.md) memetakan keputusan ke dokumen dan gate. Riwayat review tersimpan dalam Git, bukan prasyarat membaca desain saat ini. [Open decisions](docs/decisions/OPEN-QUESTIONS.md) mencatat requirement deployment/data/credential/SLO dan review yang belum selesai.

Document checks dilaporkan di [VALIDATION](docs/reviews/VALIDATION.md). M0–M2 local closure sekarang mempunyai fresh `verify` + 21/21 browser E2E evidence; P1 gate dan M2 gateway gates yang applicable tercatat di [M1](docs/milestones/M1.md), [Acceptance](docs/testing/ACCEPTANCE.md), dan [Contract execution evidence](docs/reviews/CONTRACT-EXECUTION.md). Production/nonlocal gates dan M3 tetap belum lulus. Rendering diagram bukan bukti distributed-system correctness. Riwayat perubahan: [CHANGELOG](docs/CHANGELOG.md).
