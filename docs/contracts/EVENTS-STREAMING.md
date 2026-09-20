# Events, SSE, dan Stream Recovery

**Design v1.** Authority: [ADR-0009](../adr/0009-stream-replay.md). Event contract adalah milik platform; source protocol SSE mendefinisikan event ID/reconnect, bukan durability aplikasi (R06 pada [SOURCES](../reviews/SOURCES.md)).

## 1. Dua kelas event

| Class | Contoh | Penyimpanan/jaminan |
| --- | --- | --- |
| Durable control/audit | accepted, attempt assigned, started, cancel requested, orphaned, terminal, usage adjustment | PostgreSQL transaction + outbox; at-least-once delivery, idempotent consumer |
| Live presentation | model.delta, tool log delta, progress fragment | Redis replay buffer; bounded retention/bytes, tidak menjadi ledger |

Tool invocation intent/outcome yang berpengaruh pada retry/safety WAJIB durable. Bukan berarti setiap baris stdout/log tool durable. Sensitive raw output disaring sebelum log/event publik; stream data mengikuti authorization execution.

## 2. Envelope event

```json
{
  "schema_version": "1",
  "event_id": "event-123",
  "execution_id": "exec-123",
  "attempt_id": "attempt-1",
  "stream_epoch": "epoch-1",
  "sequence": 12,
  "type": "model.delta",
  "occurred_at": "2026-09-20T00:00:00Z",
  "payload": {"text": "Hasil"}
}
```

Sequence monoton per stream epoch; bukan urutan global seluruh aplikasi. SSE `id` adalah opaque cursor mengikat execution/attempt/epoch/position. Durable control event memiliki ID stabil saat relay ulang. Consumer dedup event ID; snapshot revision digunakan untuk durable state, tidak disamakan dengan live sequence.

SSE frame konseptual:
```text
id: opaque-exec-attempt-epoch-sequence
event: model.delta
data: {"event_id":"event-123","payload":{"text":"Hasil"}}

```

Implementasi codec menghasilkan field `id:`, `event:`, `data:` tepat sesuai protokol tanpa prefiks spasi. Heartbeat connection adalah SSE comment, tidak menambah model usage.

## 3. Event catalogue

| Event | Durable | Meaning |
| --- | --- | --- |
| execution.accepted | Ya | Admission committed |
| execution.started | Ya | Active execution starts |
| attempt.started / attempt.orphaned / attempt.ended | Ya | Attempt lifecycle |
| model.delta | Tidak | Partial unvalidated output |
| tool.started / tool.completed | Ya untuk invocation state | Approved operation began/ended; payload detail dapat reference |
| execution.cancel_requested | Ya | Durable intent committed |
| execution.completed / failed / cancelled / timed_out | Ya | Public terminal state committed |
| usage.updated | Ya untuk accepted evidence/aggregate revision | Financial state dapat bergerak setelah execution terminal |
| stream.reset_required | Tidak | Current hot stream tidak dapat dilanjutkan dari cursor |

Terminal execution event dapat tiba sebelum usage final. Live token fragments tidak dapat dianggap hasil resmi setelah attempt fail/fence. Emit attempt boundaries agar UI tidak menggabungkan dua attempts menjadi satu jawaban tanpa penanda.

## 4. Replay contract

Candidate window dari principal: 10 menit. Implementasi WAJIB membatasi juga total bytes/events per execution dan tenant; advertised earliest_available_cursor menjadi source untuk resume. Byte eviction dapat membuat cursor invalid lebih cepat; client tidak boleh dijanjikan 10 menit tanpa syarat kapasitas.

GET dengan valid cursor menerima event sesudah cursor, tidak menjalankan model lagi. GET tanpa cursor menerima snapshot reference dan event dari posisi yang masih tersedia sesuai request policy; tidak mengarang prefix yang hilang. Stream reconnect ke execution lain/tenant lain ditolak, bukan dianggap cursor sah.

Jika cursor tidak lagi tersedia, respond `410 STREAM_RESUME_EXPIRED` sebelum SSE headers, dengan `snapshot_url` yang tetap auth-protected. Bila kehilangan buffer terjadi setelah HTTP 200, emit `stream.reset_required` bila mungkin lalu tutup; client fetch snapshot. Native SSE transport tidak otomatis menyelesaikan flow 410 ini; SDK/BFF wajib menangani.

Redis restart/failover yang kehilangan stream state membuat epoch baru; jangan mengulang sequence seolah history lama masih utuh. Server menyatakan gap/resync. Final result tetap tersedia dari SoR/artifact sesuai retention, tidak bergantung pada hot buffer.

## 5. Backpressure dan disconnect

Per-subscriber output queue dibatasi. Slow client didisconnect dengan resumable cursor atau reset, tidak menahan semua provider/worker. Per-execution buffer dibatasi tanpa menggugurkan durable control events. Polling status menggunakan backoff dan ETag/revision ketika diterapkan; bukan tight loop.

Client disconnect default detach, bukan cancel. Untuk chat yang membutuhkan stop-on-disconnect, profile harus mendeklarasikan policy eksplisit; explicit cancel tetap lebih deterministik. Provider connection gagal di tengah output menghasilkan attempt failure/partial outcome, bukan silent continuation melalui provider berbeda.

## 6. Durability dan ordering

Finalization transaction menulis terminal state, result reference, dan control event/outbox bersama. Outbox relay dapat duplicate; consumer menggunakan ID/revision. Kegagalan fan-out tidak membatalkan result yang telah committed. Outbox ordering per execution dijaga oleh revision; transport lintas partition tidak diasumsikan global ordered.

Live stream bisa mendahului durable final state, sehingga UI harus menggunakan terminal snapshot sebagai authority. Outbox flush tidak boleh mengklaim semua live deltas sudah diarsipkan. Raw trace archive opsional berdasarkan policy; manifest menyatakan completeness.

Tests G10/G11/G23, diagram [stream recovery](../diagrams/06-streaming-artifacts.md).
