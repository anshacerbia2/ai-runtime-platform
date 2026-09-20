# Execution dan Attempt Lifecycle

**Canonical state model baseline 0.2.** Mengadopsi empat dimensi principal dengan amendment M01 pada [rekonsiliasi](../reviews/RECONCILIATION.md). Semua nama status di dokumen/diagram merujuk halaman ini.

## 1. Execution tidak sama dengan business job

Execution adalah satu permintaan AI yang di-admit. Attempt adalah satu percobaan teknis di bawah execution. App dapat menolak hasil execution yang `COMPLETED` karena aturan bisnis; itu tidak mengubah fakta bahwa execution selesai. App membuat step/job outcome miliknya sendiri.

### Public execution status

| Status | Arti | Jalur berikut yang diizinkan |
| --- | --- | --- |
| ACCEPTED | Admission + idempotency + reservation committed | QUEUED, RUNNING, CANCEL_REQUESTED, FAILED |
| QUEUED | Menunggu agent/resource dispatch | RUNNING, CANCEL_REQUESTED, FAILED, TIMED_OUT |
| RUNNING | Attempt aktif atau wait antar-step terotorisasi | COMPLETED, FAILED, CANCEL_REQUESTED, TIMED_OUT, RECONCILING, QUEUED |
| CANCEL_REQUESTED | Durable intent menghentikan pekerjaan | CANCELLED, RECONCILING; completion yang sudah menang CAS tetap terminal |
| RECONCILING | Authority/compute/remote outcome memerlukan pemeriksaan | QUEUED (safe retry), FAILED, TIMED_OUT, CANCELLED |
| COMPLETED | Final result diterima platform dan requirements teknis terpenuhi | Tidak dihidupkan kembali; accounting dapat berubah |
| FAILED | Execution berakhir gagal; reason/detail tetap eksplisit | Tidak dihidupkan kembali |
| CANCELLED | Platform tidak akan dispatch langkah baru dan local termination telah dipastikan bila ada sandbox | External/accounting uncertainty tetap dapat direkonsiliasi |
| TIMED_OUT | Deadline execution terlampaui; no further dispatch | Cleanup/remote/usage reconciliation dapat berlanjut |

Status terminal menyatakan keputusan workflow execution, bukan klaim semua proses remote berhenti. `TIMED_OUT` dengan compute UNKNOWN harus menampilkan cleanup_pending. `FAILED` reason `EXTERNAL_OUTCOME_UNKNOWN` menggantikan kombinasi enum ad hoc `FAILED_WITH_EXTERNAL_AMBIGUITY` dari principal; alias dapat dimap pada adapter, bukan digunakan diam-diam sebagai sukses.

### Attempt status

`PREPARED -> DISPATCHED -> RUNNING -> SUCCEEDED | FAILED | CANCELLED | TIMED_OUT`. Kehilangan ownership: `DISPATCHED/RUNNING -> ORPHAN_SUSPENDED -> ABANDONED` setelah reconciliation decision. Retry membuat attempt baru; attempt lama tidak menjadi RUNNING lagi. `PREPARED` yang dibatalkan sebelum dispatch dapat menjadi CANCELLED tanpa sandbox pernah ada.

## 2. Empat dimensi dan record pendukung

| Dimensi | Nilai baseline | Catatan |
| --- | --- | --- |
| Authority | UNASSIGNED, ACTIVE, LOST, FENCED, RELEASED | ACTIVE diverifikasi pada acceptance command; terminal record dapat RELEASED |
| Local compute | NOT_APPLICABLE, STARTING, RUNNING, TERMINATING, EXITED, KILLED, UNKNOWN | Exit code/signal/termination receipt adalah evidence terpisah |
| External operations | NONE, IN_FLIGHT, COMMITTED, FAILED, MIXED, UNKNOWN_IN_FLIGHT | Aggregate dari per-operation records, bukan mengganti detail masing-masing |
| Accounting | UNRESERVED, RESERVED, PENDING_RECONCILIATION, SETTLED, OVERAGE_SETTLED | Completeness/cost basis/verification/reconciliation source terpisah |

External operations berarti domain-mutating tool operations. Direct model request yang masih berjalan dilacak sebagai provider invocation state, tidak memaksa external aggregate menjadi COMMITTED. Model call juga bisa tetap billable setelah disconnect.

`SETTLED_FROM_ORPHAN` dari principal dinormalisasi menjadi accounting SETTLED plus `reconciliation_source=orphan`; tidak boleh membuat semua evidence signature-valid otomatis final. Signed worker metrics bukan bukti completeness atau provider billing.

## 3. Preconditions utama

**Result completion:** result manifest/schema valid secara teknis, authoritative generation cocok pada finalization transaction, belum ada cancel/failure terminal yang menang, dan tidak ada required mutating operation yang belum terselesaikan. Untuk read-only chat external NONE sah. Accounting tidak menjadi precondition completion.

**Failure:** explicit runtime/provider/tool failure dapat menghasilkan FAILED dengan compute EXITED atau NOT_APPLICABLE; SIGKILL tidak wajib. Unknown side effect dikembalikan dengan operation IDs/status query refs. Result parsial diberi label partial, tidak menggantikan final contract.

**Cancel:** durable intent menghentikan dispatch baru. Supervisor mengirim abort, menghentikan process tree bila perlu, memeriksa termination. Sinyal dikirim atau ACK diterima saja bukan proof exit. Remote call/mutation yang tidak dapat dibatalkan tetap unknown/in-flight sampai reconciled.

**Timeout:** deadline bukan worker-failure detector. Platform dapat menutup execution sebagai TIMED_OUT sambil cleanup/accounting tetap pending. Capacity/hold tidak otomatis dilepas hanya karena status terminal.

## 4. Kombinasi yang wajib dapat direpresentasikan

| Execution | Compute | External | Accounting | Interpretation |
| --- | --- | --- | --- | --- |
| COMPLETED | NOT_APPLICABLE | NONE | PENDING_RECONCILIATION | Chat final tersedia, billing belum lengkap |
| COMPLETED | EXITED | COMMITTED | SETTLED | Required effect confirmed dan result selesai |
| FAILED | EXITED | NONE | SETTLED | Runtime gagal biasa, usage terhitung |
| FAILED | KILLED | UNKNOWN_IN_FLIGHT | PENDING_RECONCILIATION | Sandbox stop, external effect/biaya belum diketahui |
| CANCELLED | KILLED | NONE | PENDING_RECONCILIATION | Local stop confirmed, provider billing belum selesai |
| TIMED_OUT | UNKNOWN | UNKNOWN_IN_FLIGHT | RESERVED | Deadline lewat; cleanup dan financial exposure masih terbuka |
| RECONCILING | UNKNOWN | NONE | RESERVED | Lease/ownership hilang, belum aman menyimpulkan outcome |

Tidak valid: COMPLETED tanpa final result, mutate official result dari fenced generation, SETTLED tanpa closure basis, atau UNKNOWN direpresentasikan sebagai zero charge.

## 5. Races dan linearization

Command state memakai expected revision + execution/current attempt/generation di satu transaksi. Complete dan cancel berkompetisi terhadap row/revision yang sama. Jika complete sudah committed, cancel menjawab snapshot terminal. Jika cancel menang, late completion tidak mempromosikan result; artifact dapat tetap menjadi quarantined evidence.

Reconciler merevokasi generation dan menetapkan orphan/fenced state secara atomik sebelum replacement assignment. Finalization yang sudah committed sebelum revocation bukan stale write retroaktif. TTL Redis tidak membuat transaksi lintas Redis/PostgreSQL atomik; authority cutover didefinisikan pada PostgreSQL CAS, bukan timestamp worker.

## 6. Retry dan reconciliation

Retry teknis memerlukan allowed category, attempt budget, deadline, safe operation semantics, dan remaining allocation. Default: no blind retry mutasi ambigu. Satu operation key dipakai lintas attempts untuk operasi logis yang sama; logical operation baru mendapat key baru melalui app authority.

Execution yang telah terminal tidak di-reopen oleh late usage. Koreksi metadata/accounting mempunyai revision dan audit entry sendiri. Business repair/publish/resubmit adalah keputusan app; gunakan new execution dengan correlation baru dan referensi predecessor jika diotorisasi.

Diagram: [state and recovery flows](../diagrams/04-recovery-cancellation.md). Tests: G04, G05, G06, G12, G13 pada [acceptance](../testing/ACCEPTANCE.md).
