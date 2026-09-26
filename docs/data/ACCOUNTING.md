# Usage, Budget, dan Financial Reconciliation

**Target accounting design baseline 0.2 dengan durable M1 subset yang sudah diimplementasikan; bukan live provider billing system.** Keputusan utama [ADR-0007](../adr/0007-durable-accounting.md), [ADR-0008](../adr/0008-late-usage.md); perubahan terhadap principal dijelaskan M02/M04/M06 pada [rekonsiliasi](../reviews/RECONCILIATION.md).

## Current accounting subset

[PrismaM1Repository](../../apps/api/src/modules/control-plane/infrastructure/prisma-m1.repository.ts) sudah mengimplementasikan admission, deterministic multi-account budget locking, reservation, cumulative UsageObservation, delta/correction LedgerEntry, transactional outbox dan idempotent PostgreSQL BudgetProjection/inbox. Race 50 admissions pada tiga unit, rollback injected failure, duplicate/cumulative evidence dan unknown-as-null mempunyai local integration evidence.

Current admission hanya menerima profileRef/inputDigest dan membuat metadata execution/attempt; tidak melakukan inference. Operator usage:verify adalah jalur posting terotorisasi. Runner evidence intake menyimpan RunnerEvidence sebagai QUARANTINED, termasuk stale assignment, tanpa menulis ledger langsung. Belum ada automated trusted-provider lookup, quarantine-to-settlement workflow, 15-minute verification window, live price source atau multi-turn execution budget enforcement.

Field physical schema tidak mencakup semua conceptual minimum fields di bawah, seperti complete invocation/provider trace atau production currency reconciliation. [Data model](DATA-MODEL.md), [lifecycle vocabulary](../contracts/EXECUTION-LIFECYCLE.md), [current evidence](../reviews/CONTRACT-EXECUTION.md). Batas implementasi ini bukan pelemahan kebutuhan verifikasi produksi.

## 1. Tujuan dan batas

Audit menjawab aplikasi/proses/langkah/attempt/invocation mana yang menggunakan AI, berapa unit yang diamati, sumber pengukuran, dasar biaya, dan ketidakpastiannya. Token bukan satu-satunya unit: runtime duration, audio seconds, image requests, tool/API charges, GPU/CPU time dapat direkam jika relevan; tidak dijumlahkan sebagai satu token count.

Satu business process dapat memiliki banyak executions dan failed attempts. Usage parent summary tidak ditambah lagi dengan child invocation yang sama. Platform tidak menjanjikan atribusi token tepat per skill bila satu invocation menggunakan beberapa skill; allocation harus diberi label estimated/allocated, bukan observed.

## 2. Data yang dipisahkan

| Record/dimensi           | Fungsi                                                                   |
| ------------------------ | ------------------------------------------------------------------------ |
| Usage observation        | Evidence mentah/normalized, immutable, source-specific identity/revision |
| Verification             | pending, verified, disputed, quarantined, rejected dengan reason         |
| Measurement completeness | complete, partial, pending, unknown; null bukan zero                     |
| Cost basis               | provider_reported, estimated, allocated, unknown                         |
| Ledger entry             | Accepted charge/adjustment dengan referenced evidence dan currency/unit  |
| Budget reservation       | Outstanding financial exposure held sebelum dispatch                     |
| Settlement state         | RESERVED, PENDING_RECONCILIATION, SETTLED, OVERAGE_SETTLED               |
| Reconciliation source    | normal, orphan, provider_lookup, audit_adjustment                        |

Claude Agent SDK cost dapat berupa client-side estimate; tidak disamakan dengan authoritative billing (R04). OpenRouter menyediakan usage/cost dan generation-ID lookup sesuai dokumentasinya (R02). Kemampuan itu tidak memastikan setiap disconnected request mempunyai ID atau complete observation. Primary-source summary: [SOURCES](../reviews/SOURCES.md).

## 3. Granularity dan identifiers

Application -> optional process/step/conversation -> execution -> attempt -> invocation -> observations. Provider request ID selalu disertai provider/account binding dan invocation context; ID kosong tidak menjadi dedup key global. Source sequence/revision membedakan update valid dari duplicate.

Observation minimum: ID, execution/attempt/invocation refs, source type + source event ID/revision, observed_at/received_at, counters/unit semantics, requested/resolved model/provider, credential-binding reference nonsecret, measurement status, cost basis, price version bila estimated, evidence digest/reference, verification status.

Input/output/cache/reasoning counters tidak selalu disjoint. Mapping adapter mendeklarasikan inclusive/exclusive semantics. Simpan normalized counters dan source semantics tanpa menambah subset ke total lagi. Null berarti unavailable; nol hanya ketika observed zero atau proven-no-call state.

## 4. Durable budget authority

PostgreSQL menyimpan account, reservation, committed charge, adjustment, serta outbox pada transaksi atomik. Redis dapat mempercepat rejection atau menampilkan projected balance, tetapi tidak boleh mengotorisasi spend yang ditolak SoR. Kehilangan cache tidak menghilangkan hold. Redis counter bukan saldo financial tunggal.

Satu account scope mempunyai `limit`, `posted_charge`, `outstanding_hold`, dan `revision`. Available dihitung `limit - posted_charge - outstanding_hold`. Gunakan fixed integer minor units (misalnya micro-USD) dengan currency/unit eksplisit, checked range, dan aturan rounding yang terdokumentasi. Jangan pakai float untuk settlement. Angka ilustrasi berikut memakai unit internal, bukan harga provider.

Scopes yang dipakai (app/profile/process bila configured) diperiksa bersama dengan deterministic lock order. Reservation terkait period/window yang ditetapkan saat admission; pergantian periode tidak menghapus outstanding hold. Kebijakan rebooking lintas periode/credit/FX harus ditetapkan accounting owner, bukan mengubah window worker-side.

## 5. Atomic admission protocol

```text
BEGIN TRANSACTION
  Resolve authenticated scope and immutable profile snapshot.
  Claim unique submission key; same key returns existing execution.
  Lock all applicable budget accounts in deterministic order.
  Read committed charges and outstanding holds.
  If any scope cannot cover requested hold: reject with NO balance mutation.
  Otherwise create execution + reservation + idempotency binding.
  Increment holds and write admission/control outbox event.
COMMIT
Only after commit may dispatch/invoke occur.
```

Pseudocode di atas menjelaskan invariant, bukan skrip SQL untuk dijalankan. Jalur M1 yang memakai row locking dan Serializable transaction sudah diuji lokal sebagaimana evidence di atas; full provider dispatch dan production contention tetap perlu bukti terpisah.

Contoh test: limit 3, charge 0, hold 0; 50 unique concurrent requests masing-masing hold 1. Tepat 3 diterima, 47 ditolak; akhir hold 3, charge 0, available 0. Rejected request tidak meninggalkan available -47. Replay key accepted tidak menambah hold lagi.

Penolakan dapat mempunyai security/audit record terpisah, tetapi tidak menciptakan financial reservation. Rate limit juga diperiksa; keputusan tentative capacity yang gagal durable admission harus dikembalikan tanpa membebaskan accepted request milik orang lain.

## 6. Envelope yang benar-benar mencakup execution

Satu `(max_input + max_output) * satu_rate` tidak mencakup input/output prices berbeda, multiple turns, retries, subagents, cache, reasoning, atau paid tools. Estimate model sederhana:

```text
E = sum over admitted invocations i:
      (input_bound_i * input_rate_i)
    + (output_bound_i * output_rate_i)
    + additional priced units_i
    + allowed tool charges
    + uncertainty allowance defined by policy
```

Rates menggunakan versioned price source dan units yang benar. Cache discounts tidak diasumsikan pasti sebelum observed. Context pertumbuhan setiap turn dan allowed retry attempts harus masuk upper bound. Provider-specific categories tidak didobelkan.

Dua strategy diizinkan:

- **Whole-execution envelope:** reserve conservative bound untuk semua attempts/turns/tools sebelum mulai; adapter harus dapat menegakkan batas yang digunakan dalam perhitungan.
- **Incremental tranche:** reserve initial bounded invocation, lalu atomically extend hold sebelum invocation berikutnya; runtime/broker harus benar-benar dapat menahan dispatch per invocation. Jangan memakai tranche bila runtime opaque dapat memanggil upstream tanpa interposition.

Max tokens, max turns, deadlines, concurrency, sandbox resource limits dan tool limits saling melengkapi. Jika runtime tidak menyediakan enforcement yang profile butuhkan, reject profile atau batasi workload secara eksplisit. Tidak ada janji deterministic abort tepat pada tagihan dolar tertentu. Exposure in-flight dan unavoidable provider charges dicatat sebagai residual risk.

## 7. Settlement dan adjustment protocol

Observation diterima dahulu, diverifikasi/dinormalisasi, kemudian posted melalui source identity dan settlement command ID yang unik. Ledger append-only untuk accepted economic events; corrections dibuat sebagai adjustment yang merujuk entry sebelumnya, bukan menghapus history.

```text
BEGIN TRANSACTION
  Deduplicate observation/settlement command.
  Lock reservation and affected accounts.
  Determine newly verified charge delta not already posted.
  Append charge/adjustment with evidence reference.
  Reduce or retain hold according to known residual exposure.
  Update account aggregates, reservation revision and settlement state.
  Write outbox projection event with monotonic account revision.
COMMIT
Project balance/usage to Redis or reporting asynchronously and idempotently.
```

Outbox pattern memisahkan database commit dari delivery lintas sistem; duplicate delivery tetap ditangani consumer (R08). Redis projection menggunakan absolute account state + revision atau equivalent dedup, bukan blind `INCRBY` dari setiap replay.

Dengan original envelope E, verified cumulative charge C dan residual exposure R: held allocation tersisa ditentukan policy supaya C+R tercakup sampai outcome lengkap. Partial charge dapat dipost tanpa melepas seluruh hold. Saat semua exposure diketahui dan closure criteria terpenuhi, residual hold dilepas dalam transaksi yang sama dengan final state.

Actual charge melebihi envelope tetap dicatat, bukan ditolak agar angka tampak aman. Mark OVERAGE_SETTLED atau pending overage, kurangi available sesuai charge, blokir new admission jika account tidak cukup, alert reviewer. Tidak menjanjikan `posted_charge <= limit` setelah unexpected provider charge; admission safety dan actual billing adalah dua pengukuran berbeda.

## 8. Late evidence dan anti-poisoning

Candidate fast-path window principal: 15 menit setelah confirmed lease expiry; bila expiry timestamp tidak pasti gunakan recorded orphan_detected_at sebagai proxy berlabel, bukan worker clock. Timestamp ini tidak mengotorisasi evidence dengan sendirinya.

Within window: authenticated intake, attempt/invocation attribution, payload/rate limits, source signature/digest, dedup, plausibility/provider cross-check sesuai risiko. Hanya verified evidence yang memengaruhi ledger. `SETTLED_FROM_ORPHAN` merupakan source annotation, bukan shortcut melewati completeness.

After window: accept into bounded quarantine/audit intake dengan reason `LATE_REVIEW_REQUIRED` (principal menyebut UNVERIFIABLE_STALE_USAGE). Periksa melalui trusted provider lookup/receipts/authorized audit. Verified evidence dapat menghasilkan idempotent adjustment; invalid evidence rejected dengan reason. Old timestamp tidak otomatis invalid, signature tidak otomatis truth.

Worker tidak memiliki write privilege ledger dan compromised sandbox tidak dapat mengirim arbitrary signed charge sebagai authoritative provider evidence. Collector identity/key rotation/revocation, schema validation, evidence size limits, and escalation menjaga integrity. Tidak membuang actual charge hanya karena worker credential sudah expired; trusted reconciliation path mengambil kembali bukti dengan authority terpisah.

## 9. Dedup, source precedence, dan completeness

Dedup observation menggunakan source event identity/revision; normalized economic posting menggunakan canonical invocation + charge category + source revision/delta. Duplicate identik no-op; conflicting same identity quarantined. Cumulative usage update mem-post selisih terhadap revision sebelumnya, tidak seluruh cumulative counter lagi. Decreasing/corrected counters butuh adjustment evidence.

Trusted provider-reported charge dapat menggantikan estimate melalui adjustment/reclassification, bukan menambahkan biaya kedua. Do not sum parent runtime total + known child model charges; tandai coverage set. Jika hanya summary tersedia, audit granularitas dinyatakan summary-level dan tidak dipalsukan per invocation.

Completeness memerlukan closure basis: expected invocation coverage, terminal evidence/lookup, known priced components, dan resolved residual exposure. Satu late event di menit kelima tidak membuktikan 100% accounting accuracy. Unknown cases tetap pending; reports mencantumkan coverage dan age.

## 10. Crash matrix

| Crash point                                             | Expected recovery                                              |
| ------------------------------------------------------- | -------------------------------------------------------------- |
| Sebelum admission commit                                | Tidak dispatch; tidak ada surviving hold                       |
| Setelah commit sebelum HTTP response                    | Same key returns same execution/hold                           |
| Setelah commit sebelum dispatch delivery                | Outbox retries; dispatcher dedup                               |
| Setelah upstream accepted sebelum response ID tersimpan | Mark ambiguous; preserve exposure, reconcile; no invented zero |
| Evidence persisted sebelum posting                      | Verifier/settler retries same command                          |
| Settlement committed sebelum Redis projection           | Outbox replays revision; no duplicate credit                   |
| Projection delivered twice                              | Idempotent projection ignores older/same revision              |
| Sandbox terminated, remote effect/usage unknown         | Hold residual stays pending according to policy                |
| Verified late charge setelah closure                    | Append adjustment; do not reopen execution                     |

## 11. Audit/reporting

Queries group by app/process/step/execution/attempt/provider/runtime/profile. Return as_of, currency, cost basis, charged/held/pending/overage, complete/partial/unknown counts, and evidence age. No high-cardinality process IDs as metric labels; detail ada di ledger/query/traces.

Budget expiry is not evidence usage zero. Manual write-off/release harus recorded policy decision, authority, rationale, dan exposure consequence; tidak menamainya settled actual cost. SLO reporting membedakan normalized-token consistency, provider charge reconciliation, estimate error, dan unresolved exposure.

Tests G07–G09/G12/G15/G25; flow [admission/settlement/late usage](../diagrams/05-budget-accounting.md).

## Shared AI connection quota groups

Logical AI Connection dapat mempunyai beberapa credential instances dan runner bindings tetapi tetap berbagi upstream provider account/project quota. `quota_group_ref` menjadi grouping authority untuk admission/rate accounting ketika provider membatasi pada account/project, bukan per local key.

Menambah runner atau key tidak boleh menggandakan budget/rate capacity secara asumsi. Provider-reported limits, contract limits, dan measured behavior menentukan effective ceiling. Chargeback tetap diatribusikan ke authenticated application/execution walaupun connection shared.
