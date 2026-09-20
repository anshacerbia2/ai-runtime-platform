# AI Runtime Platform

Shared AI execution platform untuk aplikasi yang membutuhkan direct chat, structured inference, atau agent/tools. **App owns business workflow; platform owns AI execution.**

**Documentation baseline:** 0.2 · 20 September 2026. Repository ini saat ini berisi rancangan dan keputusan arsitektur. Tidak ada service, adapter, database migration, atau deployment yang diimplementasikan oleh pembaruan dokumentasi ini.

## Mulai membaca

| Kebutuhan | Dokumen |
| --- | --- |
| Konsep, boundary, komponen, invariant | [ARCHITECTURE.md](ARCHITECTURE.md) |
| Urutan implementasi dan gate | [PLAN.md](PLAN.md) dan [ROADMAP.md](ROADMAP.md) |
| Kontrak integrasi aplikasi | [API](docs/contracts/API.md) |
| Seluruh dokumen dan reading paths | [Documentation index](docs/INDEX.md) |
| Visual alur normal dan kegagalan | [Diagram catalogue](docs/diagrams/README.md) |
| Alasan, alternatif, dan konsekuensi keputusan | [14 ADR](docs/adr/README.md) |
| Perubahan terhadap audit principal | [Reconciliation register](docs/reviews/RECONCILIATION.md) |
| Pengujian produksi yang masih harus dibuktikan | [Acceptance gates](docs/testing/ACCEPTANCE.md) |

## Mental model

```text
Application
  | prompt/input + profile + optional process/step
  v
AI Runtime Platform
  +-- Model Gateway: OpenRouter and direct adapter
  +-- Agent Runtime: Claude, later Codex and Gemini
  +-- Result, events, and usage audit
  |
  v
Application decides the next business step
```

Direct chat tidak membutuhkan business job atau plugin. Execution ID dan authenticated app identity tetap tersedia. Model, provider, agent runtime, credential binding, dan app-owned harness adalah konsep terpisah.

## Baseline choices

OpenRouter-first dengan pembuktian Direct Anthropic adapter pada Phase 2; primary route ditentukan profile. Claude adalah runtime awal. Managed Execution Envelope menormalkan lifecycle, bukan menjanjikan semua agent identik. Tiered storage memisahkan durable PostgreSQL state/accounting, Redis heartbeat/replay, dan object artifacts.

Completion tidak menunggu settlement. Reservasi durable dibuat sebelum dispatch; penolakan tidak mengurangi saldo. Lease renewal tidak membangkitkan key yang hilang. Late usage dapat direkonsiliasi tanpa memberi worker lama authority kembali. Stateful tool retry memerlukan receiver-supported operation key/status semantics.

## Status dan provenance

[AUDIT.md](AUDIT.md) adalah principal final sign-off yang dipertahankan tanpa perubahan. Koreksi operasional setelah review dipisahkan sebagai amendments; tidak diklaim telah ditandatangani kembali oleh principal. [Open decisions](docs/decisions/OPEN-QUESTIONS.md) mencatat requirement deployment/data/credential/SLO yang belum ditetapkan.

Document checks dilaporkan di [VALIDATION](docs/reviews/VALIDATION.md). Gate G01–G25 adalah requirement pengujian masa implementasi dan belum dijalankan; rendering diagram bukan bukti distributed-system correctness. Riwayat perubahan: [CHANGELOG](CHANGELOG.md).
