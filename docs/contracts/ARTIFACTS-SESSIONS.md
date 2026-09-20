# Artifact, Workspace, dan Session Contract

**Baseline 0.2.** Lihat [ADR-0014](../adr/0014-artifacts-sessions.md). Resource reference bukan arbitrary path/URL dan bukan permission.

## 1. Artifact lifecycle

`DECLARED -> UPLOADING -> VERIFIED -> ATTACHED -> EXPIRED/DELETED`. QUARANTINED digunakan untuk invalid/malicious/stale output. Upload selesai bukan berarti artifact adalah hasil resmi suatu execution.

App meminta upload intent dengan content type, expected size/checksum, classification, dan purpose. API menghasilkan opaque artifact ID dan short-lived scoped upload grant. Completion memverifikasi metadata/checksum/quota; worker hanya menerima read grants untuk input authorized. URL fetch arbitrary tidak aktif sebagai default; approved fetch tool wajib mencegah SSRF.

Worker output ditulis di attempt-specific prefix dan menghasilkan immutable manifest: artifact IDs, digests, sizes, schema/version, producer attempt/runtime/profile, completeness. Finalization service memeriksa manifest tersedia dan generation berwenang sebelum result pointer di SoR dipromosikan. Crash setelah upload sebelum final commit meninggalkan candidate artifact untuk cleanup, bukan published output.

## 2. Result publication protocol

Upload bytes -> verify checksum/scan applicable -> store candidate manifest -> fenced finalization transaction menulis result reference + terminal control event/outbox. Object storage dan PostgreSQL tidak dianggap satu transaksi; recovery memeriksa referensi dan menangani orphan object. Jangan menandai COMPLETED sebelum required result object dapat dibaca menurut storage consistency contract.

Stale worker boleh menghasilkan candidate artifact tetapi tidak dapat mengubah official pointer. Link artifacts dalam usage/evidence tidak mengubah outcome execution. Final result bukan hasil menggabungkan ulang token dari Redis; gateway/worker memiliki durable finalization path sendiri.

## 3. Access dan retention

Setiap metadata/read/list/grant memeriksa tenant/application/actor permissions. Signed URL berumur pendek dan scope object/method; dicabut atau expired sesuai incident process sejauh mekanisme mendukung. Secrets, credentials, dan raw prompts tidak ditempatkan pada public object metadata/filenames.

Retention ditentukan per data class/profile: input, output, workspace, transcript, usage metadata, quarantine. Principal menyebut 30–90 hari sebagai arah policy object store; baseline tidak menjadikannya universal. Tidak ada audit SoR permanen otomatis untuk semua payload. Legal/data policy owner menetapkan retention/deletion/hold sebelum produksi.

Deletion job menghapus bytes dan derivatives, membuat tombstone metadata minimal sesuai policy, dan menangani backup retention. Penghapusan artifact tidak boleh membuat settled charge terhitung ulang nol. Cache/buffer mengikuti scope deletion sejauh data masih retained; window propagation dan exception legal hold harus documented.

## 4. Workspace isolation

Workspace per attempt; readonly input grants, writable output/temp sesuai quota. Tidak ada host mount arbitrary, shared provider credential file, atau socket host. Checkpoint memuat data yang diizinkan dan runtime/version signature; secrets dikecualikan. File links/symlinks/path traversal divalidasi saat materialisasi/export.

Cleanup berjalan setelah local exit terkonfirmasi dan required artifact/evidence difinalisasi, bukan hanya setelah client disconnect. Resource stale dengan unresolved external outcome dapat dibersihkan tanpa menghapus operation/usage evidence; state local cleanup dan financial reconciliation dipisahkan.

## 5. Conversation dan runtime session

Conversation ID dimiliki app; platform tidak menguasai history bisnis. Direct chat dapat stateless dengan messages setiap call. Optional runtime session menyimpan authorized pointer/checkpoint untuk same-runtime continuity, bukan janji persistent business memory.

Session record: tenant/application, session ID, runtime/version, profile revision, owner actor scope, expected revision, active execution, checkpoint ref, expiry. Satu writer per session; concurrent send dengan revision sama memberi 409 SESSION_BUSY/SESSION_REVISION_CONFLICT. Resume harus memastikan prior writer fenced/terminated sesuai recovery policy.

Idempotent replay submission memakai session revision awal, bukan mengirim ulang pesan ke session yang sudah maju. Branching conversation dinyatakan sebagai session baru dengan authorized snapshot bila runtime mendukung. Cross-runtime atau incompatible version resume ditolak; app dapat mengirim portable summary/artifacts ke new execution dengan label restart, bukan resume transparan.

## 6. Failure cases

| Failure | Behavior |
| --- | --- |
| Upload grant expired | Renew authorized grant, no duplicate logical artifact by accident |
| Worker dies mid-upload | Candidate incomplete, no official result promotion |
| Object committed, DB finalization failed | Retry finalization idempotent jika authority masih sah; selain itu quarantine |
| Redis lost | Final artifact/snapshot tetap lewat SoR/object store; stream may require resync |
| Session expired | Explicit 410/resource expiry; app decides restart |
| Old worker resumes same session | Reject stale generation/revision, no concurrent writer |

Tests G19/G20/G24; diagram [artifact/session flows](../diagrams/06-streaming-artifacts.md).
