# ADR Traceability — Baseline 0.2

**20 September 2026.** Register ini memetakan topik dan klarifikasi baseline ke [ADR](../adr/README.md), spesifikasi, dan pengujian. ADR adalah rujukan keputusan aktif; register ini bukan sumber aturan atau approval tersendiri.

## 1. Otoritas dan batas

Kebutuhan produk tetap: platform agnostic; app owns job/workflow; direct chat tanpa fake job; OpenRouter awal; Claude/Codex/Gemini; plugin contract; audit penggunaan per process. Keputusan dan trade-off dijelaskan di ADR, gambaran sistem di [Architecture](../architecture/ARCHITECTURE.md), dan operational semantics pada kontrak/data/reliability.

ID P01–P08 dan M01–M10 dipertahankan agar catatan baseline tetap dapat ditelusuri. ID tersebut sekarang dibaca sebagai topik/klarifikasi yang dipetakan ke ADR, bukan nomor bagian dokumen review yang harus tersedia. Riwayat diskusi tetap di Git dan percakapan; keputusan berikut dapat dipahami tanpa membuka arsip tersebut.

Review baseline yang belum selesai tetap dicatat sebagai O11 pada [OPEN-QUESTIONS](../decisions/OPEN-QUESTIONS.md). Tidak ada perubahan status approval atau klaim implementasi hanya karena rujukan dialihkan. Jika spesifikasi bertentangan dengan ADR, selaraskan melalui perubahan keputusan yang tercatat sebelum implementasi terkait diteruskan.

## 2. Peta topik keputusan

| ID | Topik | Keputusan aktif | Spesifikasi |
| --- | --- | --- | --- |
| P01 | Workflow ownership dan Managed Execution Envelope | [ADR-0001](../adr/0001-application-ownership.md), [ADR-0002](../adr/0002-managed-envelope.md) | [PROFILES-ADAPTERS](../contracts/PROFILES-ADAPTERS.md) |
| P02 | Tiered Storage dan durable accounting | [ADR-0003](../adr/0003-tiered-storage.md), [ADR-0007](../adr/0007-durable-accounting.md) | [DATA-MODEL](../data/DATA-MODEL.md) |
| P03 | Policy-driven default route | [ADR-0004](../adr/0004-routing-dual-adapter.md) | [PROFILES-ADAPTERS](../contracts/PROFILES-ADAPTERS.md) |
| P04 | State fencing terpisah dari late usage | [ADR-0005](../adr/0005-leases-fencing.md), [ADR-0008](../adr/0008-late-usage.md) | [ACCOUNTING](../data/ACCOUNTING.md) |
| P05 | Dimensi state independen | [ADR-0006](../adr/0006-orthogonal-state.md) | [EXECUTION-LIFECYCLE](../contracts/EXECUTION-LIFECYCLE.md) |
| P06 | Gate sebelum migrasi produksi | [ADR-0013](../adr/0013-evolution-gates.md) | [ACCEPTANCE](../testing/ACCEPTANCE.md) |
| P07 | Stateful tool idempotency/status | [ADR-0010](../adr/0010-tool-side-effects.md) | [TOOLS-PLUGINS](../contracts/TOOLS-PLUGINS.md) |
| P08 | Dual adapter, Claude lalu runtime tambahan | [ADR-0004](../adr/0004-routing-dual-adapter.md), [ADR-0013](../adr/0013-evolution-gates.md) | [PLAN](../PLAN.md), [ROADMAP](../ROADMAP.md) |

## 3. Peta klarifikasi operasional

| ID | Klarifikasi baseline | Keputusan aktif | Verification |
| --- | --- | --- | --- |
| M01 | Completion tidak menunggu settlement; external NONE dan normal exit sah; authority RELEASED setelah finalisasi sah | [ADR-0006](../adr/0006-orthogonal-state.md) | G21 |
| M02 | Durable check-and-reserve; penolakan tidak mengubah saldo; semua financial scopes diperiksa atomik | [ADR-0007](../adr/0007-durable-accounting.md) | G07/G09 |
| M03 | Compare-and-renew existing owner/generation/epoch; missing lease tidak dibangkitkan; durable fence menentukan cutover authority | [ADR-0005](../adr/0005-leases-fencing.md) | G04/G05/G06 |
| M04 | Window hanya membatasi fast path; older evidence dikarantina dan dapat menghasilkan verified adjustment; completeness tetap diverifikasi | [ADR-0008](../adr/0008-late-usage.md) | G12/G15 |
| M05 | Settlement, hold release, dan outbox dalam transaksi PostgreSQL yang sama; Redis menjadi revisioned projection | [ADR-0007](../adr/0007-durable-accounting.md) | G08 |
| M06 | Whole-execution envelope atau enforceable per-invocation tranche mencakup retries/tools/context growth | [ADR-0007](../adr/0007-durable-accounting.md) | G25 |
| M07 | Tidak ada periodic heartbeat writes; discrete cancel/revocation/intent/reservation/control records tetap durable | [ADR-0003](../adr/0003-tiered-storage.md), [ADR-0005](../adr/0005-leases-fencing.md) | G09/G23 |
| M08 | Nominal detection bound memerlukan delay budget; fixture correctness dan unknown coverage bukan jaminan universal | [ADR-0013](../adr/0013-evolution-gates.md) | G04/G12 |
| M09 | Aplikasi melalui authenticated API; topology berdasarkan kebutuhan; PostgreSQL financial authority | [ADR-0003](../adr/0003-tiered-storage.md), [ADR-0012](../adr/0012-deployment-dispatch.md) | G01/G07 |
| M10 | Stable operation key lintas attempts/business retry untuk operasi sah yang sama; receiver scope/retention diverifikasi | [ADR-0010](../adr/0010-tool-side-effects.md) | G13/G14 |

Gate IDs merujuk [ACCEPTANCE](../testing/ACCEPTANCE.md); seluruh implementation gates masih NOT RUN. Peta ini tidak mengubah isi keputusan, parameter kandidat, atau acceptance criteria.

## 4. Cakupan keputusan pendukung

Stream/replay mengikuti [ADR-0009](../adr/0009-stream-replay.md); security mengikuti [ADR-0011](../adr/0011-sandbox-security.md); deployment/dispatch mengikuti [ADR-0012](../adr/0012-deployment-dispatch.md); artifact/session mengikuti [ADR-0014](../adr/0014-artifacts-sessions.md). API/error examples, transaksi, runbooks, SLI, migrasi, dan diagram menjabarkan keputusan terkait, bukan bukti bahwa runtime sudah tersedia.

## 5. Pemeliharaan dan sejarah

Perubahan keputusan dilakukan lewat ADR dan disinkronkan ke spesifikasi, diagram, plan, serta gate. Pembaruan navigasi atau penghapusan sumber historis tidak menutup open decisions. Catatan sebelumnya tetap dapat ditelusuri pada riwayat Git; register ini tidak menggantikan atau merekonstruksi dokumen yang dihapus.

Referensi publik dan asal kebutuhan: [SOURCES](SOURCES.md). Pemeriksaan dokumentasi dan batas verifikasinya: [VALIDATION](VALIDATION.md). Titik masuk keputusan: [ADR index](../adr/README.md).
