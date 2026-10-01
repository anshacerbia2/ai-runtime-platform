# Tools, Plugins, dan Stateful Operation Contract

**Baseline 0.2.** Principal mewajibkan idempotency/status query untuk mutating tools. Di sini syarat tersebut diperjelas menjadi receiver-supported semantics, bukan sekadar menambahkan parameter di wrapper. Lihat [ADR-0010](../adr/0010-tool-side-effects.md).

## Implementation boundary

Fondasi internal `control.tool_effects` sudah menyimpan intent/digest dan state `PREPARED`, `DISPATCHING`, `UNKNOWN`, `COMMITTED`, atau `NO_EFFECT`. Repository memeriksa assignment/generation/epoch saat menerima operasi baru; service memakai status lookup bila invoke sebelumnya ambigu. Test PostgreSQL mencakup crash sesudah receiver commit sebelum receipt tersimpan, concurrent duplicate, changed-input conflict, retention kedaluwarsa, dan stale assignment. Adapter HTTP internal memakai origin terkonfigurasi, HTTPS (kecuali loopback fixture), no-redirect, bounded timeout/response, serta credential callback; fixture membuktikan invoke/status dan penolakan receipt invalid. Ini belum menjadi tool broker aktif: validasi lease Redis pada invocation, receiver produksi dengan atomic dedup/retention, authenticated status API untuk aplikasi, dan runner integration belum ada.

Registry metadata internal `control.plugin_packages` sekarang menyimpan package app-owned immutable berstatus STAGED/ACTIVE/REVOKED. Aktivasi memerlukan verifier attestation dengan digest cocok; belum ada verifier produksi atau management route, sehingga tidak ada package produksi yang dapat diaktifkan dari composition. Resolve ACTIVE membatasi aplikasi, digest, runtime, dan permissions. Paket runner dapat mematerialize bundle JSON immutable setelah full-bundle/file digest, revocation, runtime, permission, path, dan size checks; file tidak dieksekusi. Profile binding, bundle delivery, signature/provenance policy, sandbox execution, workspace, dan MCP adapter belum ada. Management receipts dan runner result/evidence messages bukan implementasi tool invocation atau plugin execution.

[Source state](../implementation/CURRENT-STATE.md) dan [active routes](../implementation/HTTP-API.md) memisahkan fondasi control plane dari pekerjaan P2/P3 ini.

## 1. Paket dan eksekusi

Plugin adalah paket app-owned yang berisi instructions/skills/templates/scripts/schema dan metadata runtime compatibility. Platform mengizinkan package immutable berdasarkan digest, bukan `pluginDir` arbitrary dari caller. Package registry tidak berarti platform memiliki workflow app.

Manifest minimum: package ID/version/digest, owner, input/output schemas, compatible runtime versions, tool names/schema, permissions, resource limits, network policy, artifact outputs, license/provenance, test evidence. Profile menyimpan package digest. Mutable download/install at runtime tidak dibolehkan tanpa verifikasi/policy.

Scripts dijalankan di sandbox/out-of-process worker, bukan proses API. Tool broker melakukan authZ sebelum invoke. MCP dapat menjadi adapter protocol discovery/call/schema; sumber MCP R07 pada [SOURCES](../reviews/SOURCES.md). MCP bukan sandbox, bukan credential vault, dan bukan jaminan idempotency penerima.

## 2. Kelas tool

| Kelas                     | Contoh                                         | Aturan                                                           |
| ------------------------- | ---------------------------------------------- | ---------------------------------------------------------------- |
| Pure/read-only            | Parse file, inspect approved artifact          | Read scope + timeout; tetap hitung compute/paid API cost         |
| Workspace-write           | Render draft di workspace attempt              | Isolated path, quotas, artifact manifest; tidak otomatis publish |
| External mutation         | Publish, update domain record, send webhook    | Stable operation key, receiver dedup/status, approval bila perlu |
| Unbounded/opaque mutation | Arbitrary shell/network dengan credential luas | Tidak eligible pada autonomous retry profile MVP                 |

Filesystem/workspace-only script masih bisa exfiltrate lewat network; klasifikasi tool bukan satu-satunya security control. Egress dan credential scope harus enforce behavior yang diizinkan.

## 3. Stable logical operation identity

`operation_id` dihasilkan/dipersist platform sebelum dispatch. `idempotency_key` diturunkan dari application + logical business operation reference + tool/action + version + input digest, atau assigned opaque key yang disimpan durable. Key tidak diturunkan hanya dari attempt ID, karena retry attempt harus menggunakan key yang sama untuk operasi logis yang sama.

Fondasi internal saat ini menurunkan receiver key SHA-256 dari version tag, application ID, dan durable operation UUID. Scope aplikasi tidak dikirim sebagai plaintext ke receiver. Ini identitas retry teknis untuk intent yang sudah ada, bukan inferensi bahwa dua execution bisnis berbeda adalah operasi yang sama.

Business operation reference dari app dipakai bila aksi harus tetap sama lintas execution/retry bisnis. Tanpa referensi itu, platform tidak boleh menebak bahwa dua arbitrary agent tool calls merupakan operasi yang sama. Mutasi baru dengan maksud berbeda membutuhkan operation identity baru dan authority aplikasi.

Store request digest. Same key + different input memberi conflict, bukan execute. Receiver retention idempotency harus melampaui retry/reconciliation horizon; jika tidak, automatic retry dinonaktifkan. Strong side-effect guarantees memerlukan receiver yang mengeksekusi dedup dan mutation secara atomik atau memberikan equivalent behavior yang diuji.

## 4. Interface konseptual

```typescript
interface StatefulTool {
  execute(
    input: JsonValue,
    context: {
      operationId: string;
      idempotencyKey: string;
      requestDigest: string;
      authorizationRef: string;
    },
  ): Promise<ToolResult>;
  checkStatus(idempotencyKey: string): Promise<{
    state: 'COMMITTED' | 'FAILED' | 'UNKNOWN';
    receiptRef?: string;
    failureGuaranteesNoEffect?: boolean;
  }>;
}
```

Ini sketch kontrak, bukan TypeScript yang sudah diimplementasikan. JsonValue/ToolResult harus didefinisikan pada P0. UNKNOWN mencakup sedang berjalan atau status tidak tersedia; adapter boleh memiliki internal state lebih rinci. FAILED hanya berarti aman retry jika receiver menjamin tidak ada effect atau same-key replay aman. Timeout/HTTP 500 sendiri tidak membuktikan no effect.

Adapter HTTP internal memakai `POST /v1/effects` dengan JSON `{idempotency_key, request_digest, input_base64}` dan `GET /v1/effects/{idempotency_key}`. Kedua respons harus `{state:"UNKNOWN"}` atau `{state:"COMMITTED"|"NO_EFFECT",receipt_ref,receipt_digest}`. Ini kontrak receiver opt-in yang harus diuji terhadap implementasi nyata; HTTP response sukses tanpa atomic same-key dedup/status guarantee tidak memenuhi G13/G14. URL berasal dari konfigurasi tepercaya dan egress sandbox tetap harus dibatasi secara terpisah.

## 5. Invocation protocol

1. Validate execution/profile/operation grants dan budget; model output tidak dapat memodifikasi grant.
2. Persist intent, operation key, request digest, target, timeout, dan receipt slot sebelum invoke.
3. Call tool dengan credential scope minimal; record upstream request/receipt bila tersedia.
4. Persist outcome/evidence dan emit durable control event.
5. Bila koneksi putus, query status dengan key sama. Jangan membuat key baru sebagai jalan pintas.

Fencing berlaku pada official result/state, sedangkan tool receipt dan usage dari attempt lama dapat diterima verifier sebagai evidence tanpa ownership. Tool mutasi melalui broker memeriksa generation/status saat admission operasi; race dengan operasi yang sudah diterima upstream tetap perlu receiver idempotency/reconciliation.

## 6. Approval dan aplikasi

Profile dapat melarang semua domain mutations dan hanya mengembalikan artifact; ini default aman untuk Scribe document generation. App memvalidasi draft lalu melakukan publish dengan idempotency domain miliknya.

Bila tool membutuhkan approval, approve/deny harus berasal dari authenticated actor app dengan scope, intent/input digest, expiration, dan audit. Tidak ada approval API/UI lengkap yang diasumsikan tersedia pada MVP; profile dengan approval requirement yang belum didukung ditolak. Runtime yang bisa meminta approval tetapi tidak menyediakan binding teruji tidak diberi automatic broad approval.

## 7. Recovery rules

Sandbox killed tidak mengubah COMMITTED menjadi FAILED dan tidak mengubah UNKNOWN menjadi no effect. App menerima operation IDs dan status references untuk keputusan bisnis. Platform dapat reconcile fakta remote dan melakukan permitted same-key infrastructure replay; tidak memutuskan kompensasi bisnis seperti menghapus dokumen yang sudah dipublikasikan.

Tests: duplicate request, changed payload same key, crash after receiver success before receipt persistence, expired idempotency retention, forged receipt, cross-application status lookup, stale owner dispatch, approval digest mismatch. Lihat G13/G14/G18 pada [acceptance](../testing/ACCEPTANCE.md).

## 8. Plugin registry dan remote capability model

Plugin adalah immutable, versioned execution package dengan `plugin_id`, version, artifact reference, digest/signature metadata, runtime compatibility, required permissions, dan lifecycle status. Profile boleh tidak memiliki plugin sama sekali.

Format materialisasi internal v1 adalah UTF-8 JSON canonical `ai-runtime-plugin/v1` dengan package ID, version, compatible runtime versions, required permissions, dan array file `{path,sha256,contentBase64}`. Trusted grant harus mengikat package ID/version, full bundle digest, state ACTIVE, runtime version, dan permission allow-list. Materializer membatasi bundle 16 MiB, 256 file, 1 MiB per file; hanya regular file relatif, tanpa symlink atau path traversal. Registry metadata app-owned sudah ada secara internal, tetapi verifier signature/provenance produksi, profile binding, sandbox mount read-only, dan release approval belum tersedia.

Worker materialize plugin ke sandbox setelah digest/policy verification. Plugin tidak boleh mengandalkan checkout path permanen pada runner host. Provider credential tidak diekspos ke plugin kecuali adapter contract secara eksplisit memerlukannya dan policy mengizinkan.

Tool dibagi menjadi: platform-owned tool, packaged plugin tool, dan remote app/service-owned tool. Remote tool dapat memakai MCP atau typed HTTP/RPC. MCP adalah planned integration mechanism, bukan adapter aktif atau requirement untuk setiap app.

Mutating tool tetap mengikuti [ADR-0010](../adr/0010-tool-side-effects.md): stable logical operation key harus bertahan melewati technical retry, dan receiver harus menyediakan deduplication/status semantics.
