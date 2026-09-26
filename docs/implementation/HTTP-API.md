# HTTP API yang Terdaftar

**Snapshot source 26 September 2026.** Tabel ini memuat 53 method/path dari apiContract dan 45 pasangan yang diekspos oleh browserContract. Bukan daftar endpoint target yang belum diimplementasikan. Sumber: [routes](../../packages/contracts/src/http/routes.ts), [gateway contract](../../packages/contracts/src/http/gateway.ts), [resource contracts](../../packages/contracts/src/http/resources.ts), [runner contracts](../../packages/contracts/src/http/runner.ts), [gateway controller](../../apps/api/src/modules/gateway/presentation/http/gateway.controller.ts), [controller resources](../../apps/api/src/modules/control-plane/presentation/http/resource.controller.ts), dan [authority policy](../../apps/api/src/modules/identity/domain/principal.ts).

## Authentication dan exposure

API memeriksa bearer principal. Pada nonlocal web, browser mengirim opaque session cookie; BFF mengambil bearer dari server-side session, bukan mempercayai Authorization dari browser. Local mode menggantinya dengan fixture token di server. Operator memerlukan role platform-operator atau platform-admin; usage:verify memerlukan platform-accountant atau platform-admin. Scopes dan jenis principal tetap diperiksa per service. Liveness tidak memerlukan token tetapi tetap tunduk pada host/origin policy.

Kolom “BFF” berarti pasangan method/path di-allowlist, bukan setiap caller memperoleh izin. Contohnya admission terdaftar pada browser contract, tetapi token operator tidak otomatis berubah menjadi application caller. Assignment, runner reports/protocol/evidence, registration dan inbox tidak diekspos ke browser.

## Operasi aktif

| Operation key dalam apiContract | Method | Path                                                         | Success HTTP | Authority                                           | BFF                                  |
| ------------------------------- | ------ | ------------------------------------------------------------ | ------------ | --------------------------------------------------- | ------------------------------------ |
| gateway.chat                    | POST   | `/v1/chat`                                                   | 200          | Application · execution:submit                      | Ya · `/api/v1/chat`                  |
| gateway.generate                | POST   | `/v1/generate`                                               | 200          | Application · execution:submit                      | Ya · `/api/v1/generate`              |
| gateway.submit                  | POST   | `/v1/executions`                                             | 200          | Application · execution:submit                      | Ya · `/api/v1/executions`            |
| gateway.execution               | GET    | `/v1/executions/:id`                                         | 200          | Application · execution:read                        | Ya · `/api/v1/executions/:id`        |
| gateway.cancel                  | POST   | `/v1/executions/:id/cancel`                                  | 200          | Application · execution:cancel                      | Ya · `/api/v1/executions/:id/cancel` |
| gateway.events                  | GET    | `/v1/executions/:id/events`                                  | 200 SSE      | Application · execution:read                        | Ya · `/api/v1/executions/:id/events` |
| resources.applications.list     | GET    | `/api/v1/applications`                                       | 200          | Operator · platform:read                            | Ya                                   |
| resources.applications.replace  | PUT    | `/api/v1/applications/:id`                                   | 200          | Operator · platform:manage                          | Ya                                   |
| resources.connections.list      | GET    | `/api/v1/connections`                                        | 200          | Operator · platform:read                            | Ya                                   |
| resources.connections.replace   | PUT    | `/api/v1/connections/:id`                                    | 200          | Operator · platform:manage                          | Ya                                   |
| resources.credentials.list      | GET    | `/api/v1/credentials`                                        | 200          | Operator · platform:read                            | Ya                                   |
| resources.credentials.replace   | PUT    | `/api/v1/credentials/:id`                                    | 200          | Operator · platform:manage                          | Ya                                   |
| resources.bindings.list         | GET    | `/api/v1/bindings`                                           | 200          | Operator · platform:read                            | Ya                                   |
| resources.bindings.replace      | PUT    | `/api/v1/bindings/:id`                                       | 200          | Operator · platform:manage                          | Ya                                   |
| resources.profiles.list         | GET    | `/api/v1/profiles`                                           | 200          | Operator · platform:read                            | Ya                                   |
| resources.profiles.publish      | POST   | `/api/v1/applications/:applicationId/profiles/:id/revisions` | 200          | Operator · platform:manage                          | Ya                                   |
| resources.aliases.list          | GET    | `/api/v1/aliases`                                            | 200          | Operator · platform:read                            | Ya                                   |
| resources.aliases.replace       | PUT    | `/api/v1/applications/:applicationId/profile-aliases/:id`    | 200          | Operator · platform:manage                          | Ya                                   |
| resources.budgets.list          | GET    | `/api/v1/budgets`                                            | 200          | Operator · platform:read                            | Ya                                   |
| resources.budgets.replace       | PUT    | `/api/v1/budgets/:id`                                        | 200          | Operator · platform:manage                          | Ya                                   |
| resources.pools.list            | GET    | `/api/v1/pools`                                              | 200          | Operator · platform:read                            | Ya                                   |
| resources.pools.replace         | PUT    | `/api/v1/pools/:id`                                          | 200          | Operator · platform:manage                          | Ya                                   |
| resources.runners.list          | GET    | `/api/v1/runners`                                            | 200          | Operator · platform:read                            | Ya                                   |
| resources.runners.lifecycle     | POST   | `/api/v1/runners/:id/lifecycle`                              | 200          | Operator · platform:manage                          | Ya                                   |
| resources.overview              | GET    | `/api/v1/overview`                                           | 200          | Operator · platform:read                            | Ya                                   |
| resources.audit.list            | GET    | `/api/v1/audit`                                              | 200          | Operator · platform:read                            | Ya                                   |
| resources.outbox.list           | GET    | `/api/v1/outbox`                                             | 200          | Operator · platform:read                            | Ya                                   |
| runner.protocol                 | GET    | `/api/runner/v1/protocol`                                    | 200          | Runner · runner:register                            | Tidak                                |
| runner.report                   | POST   | `/api/runner/v1/reports`                                     | 200          | Runner · runner:report                              | Tidak                                |
| runner.evidence                 | POST   | `/api/runner/v1/evidence`                                    | 202          | Runner · runner:report                              | Tidak                                |
| assignments.grant               | POST   | `/api/v1/executions/:id/assignments`                         | 200          | Operator · platform:manage                          | Tidak                                |
| assignments.revoke              | POST   | `/api/v1/executions/:id/assignments/revoke`                  | 200          | Operator · platform:manage                          | Tidak                                |
| live                            | GET    | `/health/live`                                               | 200          | Public (host/origin policy tetap berlaku)           | Tidak                                |
| lab.health                      | GET    | `/api/m0/health`                                             | 200          | Application · lab scope                             | Ya                                   |
| lab.profiles                    | GET    | `/api/m0/profiles`                                           | 200          | Application · lab scope                             | Ya                                   |
| lab.examples                    | GET    | `/api/m0/examples`                                           | 200          | Application · lab scope                             | Ya                                   |
| lab.schemas                     | GET    | `/api/m0/contracts`                                          | 200          | Application · lab scope                             | Ya                                   |
| lab.openapi                     | GET    | `/api/m0/openapi.json`                                       | 200          | Application · lab scope                             | Ya                                   |
| lab.validate                    | POST   | `/api/m0/validations`                                        | 200, 201     | Application · lab scope                             | Ya                                   |
| lab.history                     | GET    | `/api/m0/history`                                            | 200          | Application · lab scope                             | Ya                                   |
| lab.record                      | GET    | `/api/m0/history/:id`                                        | 200          | Application · lab scope                             | Ya                                   |
| controlPlane.snapshot           | GET    | `/api/m1/control-plane`                                      | 200          | Operator platform:read / Application execution:read | Ya                                   |
| controlPlane.manage             | PUT    | `/api/m1/control-plane`                                      | 200          | Operator · platform:manage                          | Ya                                   |
| controlPlane.admit              | POST   | `/api/m1/admissions`                                         | 200, 201     | Application · execution:submit                      | Ya                                   |
| controlPlane.execution          | GET    | `/api/m1/executions/:id`                                     | 200          | Application · execution:read                        | Ya                                   |
| controlPlane.cancel             | POST   | `/api/m1/executions/:id/cancel`                              | 201          | Application · execution:cancel                      | Ya                                   |
| controlPlane.usage              | POST   | `/api/m1/usage`                                              | 201          | Operator · usage:verify                             | Ya                                   |
| controlPlane.artifact           | POST   | `/api/m1/artifacts`                                          | 201          | Application · artifact:write                        | Ya                                   |
| controlPlane.registerRunner     | POST   | `/api/m1/runners/register`                                   | 201          | Runner · runner:register                            | Tidak                                |
| controlPlane.inbox              | POST   | `/api/m1/inbox/:consumer/:eventId`                           | 201          | Operator · platform:manage                          | Tidak                                |
| controlPlane.audit              | GET    | `/api/m1/audit`                                              | 200          | Operator · platform:read                            | Ya                                   |
| controlPlane.outbox             | GET    | `/api/m1/outbox`                                             | 200          | Operator · platform:read                            | Ya                                   |

Nama parameter pada source memakai :id; OpenAPI menuliskannya sebagai {id}. Success codes di tabel adalah deklarasi implementasi saat ini: resource PUT dan publish revision memberi 200, bukan jaminan 201 hanya karena suatu record baru dibuat. Runner result.proposed memberi 200 untuk proposal yang diterima, bukan completion AI.

## Resource command dan receipt

Resource mutations memerlukan Idempotency-Key (1–160 karakter pada pola alfanumerik, titik, underscore, colon, dan hyphen). Body bersifat strict dan tidak boleh menyertakan kind atau target path fields sebagai override. expectedRevision=0 menandai create path pada command yang mendukung create; update memakai revision/version resource yang berlaku. Profile publish membuat immutable revision; alias memakai version sebagai concurrency precondition.

Contoh body untuk PUT /api/v1/connections/demo-connection dengan request key baru (fixture, bukan konfigurasi provider nyata):

```json
{
  "expectedRevision": 0,
  "displayName": "Synthetic connection",
  "environment": "local",
  "provider": "fixture",
  "authMode": "API_KEY",
  "sharingMode": "DEDICATED",
  "quotaGroupRef": null,
  "status": "ENABLED"
}
```

Response resource mutation berbentuk {resource, receipt}. receipt memuat id, key, replayed dan completedAt; resource memakai satu schema spesifik, tanpa union ambigu. Receipt menyimpan hasil historis. Same key dengan operation/target/revision/body berbeda menghasilkan conflict. Window replay tujuh hari; expired receipt ditolak dengan REQUEST_KEY_EXPIRED dan key tidak dibebaskan otomatis. Assignment grant/revoke memakai receipt internal juga, tetapi response-nya Assignment, bukan envelope resource/receipt. Lihat [state aktual](CURRENT-STATE.md) dan [ADR-0029](../adr/0029-replay-resources-runner-authority.md).

Legacy PUT /api/m1/control-plane masih menerima ManagementCommand dengan discriminator kind dan menghasilkan tagged ManagementResult. Ia tidak memakai receipt management dan tidak mendapat automatic retry hanya karena caller menambahkan header key. Tetap gunakan resource operations untuk client baru.

## Pagination dan batas output

Resource query mendukung limit dan cursor. limit default 20, maksimum 100; response {items, nextCursor, limit, consistency:"live-keyset"}. Urutan id ascending, kecuali aliases yang memakai applicationId/profileRef ascending. Cursor mengikat resource dan caller; bukan kredensial, tidak perlu dipercaya sebagai pemberi akses. Pagination hidup dapat berubah ketika data ditambah/dihapus; bukan snapshot lintas-request.

Credential list tidak mengambil secretRef. Outbox resource list tidak mengambil payload. Overview hanya count sembilan registries + observedAt dan consistency:"independent-observations". Response page maksimum 1 MiB dan resource mutation maksimum 64 KiB melalui policy client; reader memeriksa page bytes setelah projected query. Tidak ada endpoint detail /api/v1/audit/:id atau object-download yang boleh diasumsikan dari adanya daftar ini.

M0 history juga default 20/maksimum 100, tetapi memakai cursor version/id dan urutan created_at descending + id descending yang mempertahankan presisi timestamp database. Response field-nya next_cursor, bukan nextCursor. Legacy M1 snapshot/audit/outbox bukan kontrak pagination baru; jangan menukar cursor antarpermukaan.

## Retry dan outcome

Client browser otomatis mengulang hanya lab.validate, controlPlane.admit, dan receipt-backed resource mutations, maksimum tiga attempt termasuk yang pertama. Eligibility berasal dari metadata operasi, key valid dan serialized body yang bisa diputar ulang; bukan nama method/header semata. Body/key sama untuk seluruh attempt. Default GET dan mutation lain satu attempt, meskipun server operation tertentu punya dedup tersendiri.

Retry memiliki satu deadline total paling tinggi 30 detik, bounded jitter, Retry-After minimum dan per-client token budget. Network/HTTP 502/503/504 eligible bila retryable bukan false; 4xx (termasuk 429), abort, timeout akhir, dan respons yang melanggar schema bukan automatic retry. BFF tidak menambahkan retry. Attachment assignment bukan browser operation; metadata receipt pada runner grant/revoke tidak berarti SDK machine sudah tersedia.

HTTP 2xx harus lolos declared status, media type, UTF-8 dan schema. Setelah dispatch, kegagalan dapat meninggalkan outcome unknown sampai receipt/response yang sah diterima. Abort bukan rollback. Hasil invalid payload di Contract Lab tetap bisa disimpan dengan 201 dan valid=false; ini bukan kegagalan transport.

## Error yang benar-benar dipetakan

| HTTP        | Code API / kondisi          | Arti implementasi                                                                                                         |
| ----------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 400         | INVALID_REQUEST             | Bentuk request, query/key atau resource relation tidak valid                                                              |
| 401         | UNAUTHENTICATED             | API bearer tidak sah; BFF punya AUTHENTICATION_REQUIRED untuk session                                                     |
| 403         | POLICY_DENIED               | Scope/role/resource policy ditolak                                                                                        |
| 404         | NOT_FOUND                   | Target tidak ada atau tidak dimiliki caller                                                                               |
| 409         | IDEMPOTENCY_CONFLICT        | Reuse key/digest mismatch atau conflict resource/revision sesuai operasi                                                  |
| 409         | STALE_ASSIGNMENT            | Assignment/token tidak lagi sesuai authority aktif                                                                        |
| 410         | REQUEST_KEY_EXPIRED         | Receipt expired, key tetap reserved                                                                                       |
| 413         | INVALID_REQUEST pada API    | Body melebihi configured API cap; BFF memakai PAYLOAD_TOO_LARGE                                                           |
| 422         | VERSION_UNSUPPORTED         | Cabang domain menolak protokol yang tidak didukung; literal version/header yang gagal schema dapat lebih dulu menjadi 400 |
| 429         | RESOURCE_EXHAUSTED          | Budget, capacity atau response envelope yang dibatasi                                                                     |
| 500         | RESPONSE_CONTRACT_VIOLATION | API tidak dapat membuktikan response sesuai kontrak; mutation mungkin sudah committed                                     |
| 503         | DEPENDENCY_UNAVAILABLE      | Exception/dependency gagal, outcome tidak otomatis rollback                                                               |
| 502/503/504 | Kegagalan BFF/upstream      | Sanitized transport failure, safe status/correlation/retry hint dipertahankan                                             |

Error schema juga mendeklarasikan common status lain untuk interoperabilitas. Deklarasi di commonResponses tidak membuktikan setiap endpoint mengeluarkan semua code tersebut. BFF memiliki taxonomy keamanan/transport sendiri; [filter API](../../apps/api/src/shared/presentation/http-exception.filter.ts) dan [forwarder](../../apps/web/src/server/api-gateway/forward.ts) menentukan mapping aktual. Tidak ada 425 sebagai status umum pekerjaan IN_PROGRESS.

## OpenAPI dan compatibility

Generated documents membedakan PlatformBearer dan BrowserSession. Tanpa deployment cookie name, BrowserSession mendeskripsikan Cookie header beserta template nama cookie, bukan field token yang dikirim user secara manual. Response headers mendokumentasikan X-Request-ID dan optional Retry-After untuk status terkait. Consumer response schema menoleransi properti tambahan, sementara runtime memproyeksikan field yang diketahui. Command schemas tetap strict.

x-runtime-behavior dan x-consumer-unknown-fields adalah metadata tambahan, bukan kode yang otomatis dieksekusi oleh SDK generik. Tidak ada bukti SDK Python/Go conformance. Legacy snapshot/manage (path yang sama), audit dan outbox ditandai deprecated pada OpenAPI, tetapi route masih berjalan; admission/accounting tidak dipensiunkan tanpa pengganti.

Field status pada sejumlah response M1 masih string terbuka. Jangan menganggap semua nilai sudah masuk enum lifecycle target atau memperlakukan unknown value sebagai success. Schema Event umum masih memiliki payload record-of-unknown; pesan runner bertipe tidak menggantikannya menjadi streaming implementation.

## Batas endpoint aktif

Gateway M2 aktif menyediakan `/v1/chat`, `/v1/generate`, `/v1/executions`, execution read/cancel, dan `/v1/executions/{id}/events` SSE melalui contract gateway aktif serta mirror BFF `/api/v1/...`. Upload grants, plugin operations, runtime sessions, dan agent/tool execution tetap target M3. Contract Lab `/api/m0/*` tetap terpisah dan contract-only; jangan memakai endpoint validation lab untuk menyimpulkan behavior provider runtime.
