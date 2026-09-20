# Reconciliation — Principal Sign-Off dan Baseline 0.2

**20 September 2026.** Tujuan: mempertahankan provenance dan menjelaskan perubahan, bukan mengubah teks principal. [AUDIT.md](../../AUDIT.md) adalah source historis terbaru dan tetap utuh. Status APPROVED FOR IMPLEMENTATION di source adalah pernyataan principal pada source tersebut; baseline amendments di bawah adalah hasil penyusunan setelah review terakhir, bukan tanda tangan baru dari principal.

## 1. Source hierarchy dan dokumen otoritatif

Kebutuhan user: platform agnostic, app owns job/workflow, direct chat tanpa fake job, OpenRouter awal, Claude/Codex/Gemini, plugin contract, audit per process. Principal memberi target Managed Execution Envelope, tiered storage, reserve–execute–settle, four dimensions, reliability gate.

Review terakhir dalam percakapan mengidentifikasi empat correctness gaps: public status gating, budget algorithm/durability, lease renewal, late reconciliation window. User lalu meminta sinkronisasi dokumen lengkap/ADR/diagram. Baseline ini **secara eksplisit mengadopsi koreksi desain**, dengan review/evidence tersisa dicatat O11. Tidak mengklaim isi AUDIT.md telah direvisi atau principal menyetujui detail baru.

Untuk implementation specification gunakan [Architecture](../../ARCHITECTURE.md), canonical contracts/data/reliability, dan ADR. Audit menjadi sumber sejarah/intent. Bila ada conflict antarcanonical documents, hentikan implementasi terkait dan perbaiki melalui ADR; jangan memilih contoh yang paling nyaman.

## 2. Accepted direction

| ID | Source principal | Baseline disposition | Canonical target |
| --- | --- | --- | --- |
| P01 | Bagian 1: Managed Execution Envelope | Retained; domain harness app-owned | PROFILES-ADAPTERS, ADR-0002 |
| P02 | Bagian 3.A: Tiered Storage | Retained with durable accounting clarification | DATA-MODEL, ADR-0003/0007 |
| P03 | Bagian 1: policy-driven default route | Retained; OpenRouter boleh primary, direct proof terpisah | PROFILES-ADAPTERS, ADR-0004 |
| P04 | Bagian 1/2: state fencing vs late usage | Retained; evidence intake tidak memulihkan authority | ACCOUNTING, ADR-0005/0008 |
| P05 | Bagian 3.B: four dimensions | Retained with corrected valid combinations | EXECUTION-LIFECYCLE, ADR-0006 |
| P06 | Bagian 4: gate sebelum migrasi | Retained; numbers/evidence calibrated | ACCEPTANCE, ADR-0013 |
| P07 | Bagian 2.3: mutating tool idempotency/status | Retained and logical key semantics specified | TOOLS-PLUGINS, ADR-0010 |
| P08 | Bagian 5: dual adapter, Claude then expansion | Retained; Codex runtime distinct from direct API | PLAN/ROADMAP |

## 3. Explicit amendments / clarifications

| ID | Detail source | Perubahan baseline dan rationale | Verification |
| --- | --- | --- | --- |
| M01 | 3.B requires COMMITTED external + SETTLED for success, SIGKILL for isolated failure | Completion independent of billing; external NONE valid; normal exit/direct compute supported; terminal authority RELEASED valid | G21, ADR-0006 |
| M02 | 3.C DECRBY then reject negative | Durable check-and-reserve, no balance mutation on rejection; all financial scopes atomic | G07/G09, ADR-0007 |
| M03 | 2.1 bare SET EX heartbeat | Compare-and-renew existing owner/generation/epoch; no missing-key resurrection; durable fence defines authority cutover | G04/G05/G06, ADR-0005 |
| M04 | 2.2 fixed 15-minute window and immediate SETTLED_FROM_ORPHAN | Fast-path window only; verify completeness; quarantine older evidence and allow verified adjustment | G12/G15, ADR-0008 |
| M05 | 3.C Redis release before PG ledger | Settlement/hold release/outbox same PG transaction; Redis revisioned projection | G08, ADR-0007 |
| M06 | 3.C single token-pair envelope while up to 15 turns | Whole-execution or enforceable per-invocation tranches; retries/tools/context growth covered | G25, ACCOUNTING |
| M07 | 2.1 PG only dispatch/final transitions | No periodic heartbeat writes retained; also persist required discrete cancel/revocation/intent/reservation/control records | G09/G23, DATA-MODEL |
| M08 | 4 detection <=20s and accurate 100% usage wording | 20s nominal component bound plus predefined delay; fixture correctness and unknown coverage, not universal certainty | G04/G12, SLO-CAPACITY |
| M09 | 3.A apps drawn directly to Redis/PG; Redis Cluster/reservations | Logical flows clarified: app through authenticated API; topology evidence-driven, PG financial authority | G01/G07, DEPLOYMENT |
| M10 | 2.3 generated key without logical-operation lifetime | Stable key across attempts/business retry when same authorized operation; receiver scope/retention verified | G13/G14, TOOLS-PLUGINS |

Amendments adalah engineering decisions/proposals dalam baseline ini. O11 meminta explicit reviewer disposition sebelum implementation contract dibekukan. Ini tidak menahan pekerjaan dokumentasi yang user minta, tetapi mencegah source sign-off dipakai sebagai bukti palsu untuk algorithm yang telah berubah.

## 4. New documentation expansions

API/error examples, transaction boundaries, artifact/session lifecycle, deployment/runbooks, SLI definitions, test catalogue, migration playbook, ADR consequences, dan detailed Mermaid flows merupakan elaborasi penulis baseline atas kebutuhan. Tidak semua detail itu tertulis pada principal source. New limits/topology/provider capabilities tidak diberi status tested tanpa evidence.

## 5. Unchanged source evidence

Principal AUDIT.md SHA-256 saat baseline dibaca: `1472b33761ceb4267b2784b7d4e7ea2111ee0f2c7ddef9c3e52351992158a46c`.

Original docs berada pada Git commit `376d435bf43589784b1f1a5d76f88be33b233365`. File hash dan reference register: [SOURCES](SOURCES.md). Pemeriksaan actual write/hash/link/diagram tercatat di [VALIDATION](VALIDATION.md). Tidak ada duplicate audit copy yang diklaim evidence baru.
