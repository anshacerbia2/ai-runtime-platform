# Control Plane Management Contract

**As-built M1 dan extensions ADR-0029, diperiksa 24 September 2026.** Resource endpoints dan database berikut sudah diimplementasikan lokal; bagian bertanda target belum menjadi fitur yang berjalan. [HTTP catalogue](../implementation/HTTP-API.md) mencatat setiap method/path dan success status; [current state](../implementation/CURRENT-STATE.md) menjelaskan batas runtime.

## 1. Resources yang diimplementasikan

| Resource            | Read surface         | Mutation surface dan makna                                                                 |
| ------------------- | -------------------- | ------------------------------------------------------------------------------------------ |
| Applications        | /api/v1/applications | PUT per id; identity mapping, environment, status, revision                                |
| AI Connections      | /api/v1/connections  | PUT per id; logical provider account metadata dan sharing mode                             |
| Credential metadata | /api/v1/credentials  | PUT per id; connection, residency, runner ref, status tanpa secret material                |
| Bindings            | /api/v1/bindings     | PUT per UUID; application/profile authorization ke connection                              |
| Profile revisions   | /api/v1/profiles     | POST application/profile revisions; immutable content dan digest                           |
| Profile aliases     | /api/v1/aliases      | PUT application/profile-alias; revision selection dan alias version                        |
| Budgets             | /api/v1/budgets      | PUT per id; unit/period/scope/limit dengan concurrency control                             |
| Runner pools        | /api/v1/pools        | PUT per id; environment/region/minimum version/status                                      |
| Runner nodes        | /api/v1/runners      | Authenticated registration pada compatibility machine route; POST lifecycle untuk operator |
| Audit               | /api/v1/audit        | Metadata list; mutation services menulis audit secara atomik                               |
| Outbox              | /api/v1/outbox       | Metadata list tanpa payload; domain transactions menulis delivery intent                   |
| Overview            | /api/v1/overview     | Count-only independent observations, bukan dump resources                                  |

Sumber schema: [resources.ts](../../packages/contracts/src/http/resources.ts), [management commands](../../packages/contracts/src/control-plane.ts), [response views](../../packages/contracts/src/http/control-plane.ts). AuthMode dan provider adalah metadata konfigurasi, bukan bukti adapter atau credential resolver sudah berjalan. Plugin Package/Version, policy approval workflows dan detailed provider health masih target.

## 2. Identity dan authorization

Application, operator dan runner adalah principal yang berbeda. Resource reads/overview memerlukan platform:read; resource mutations dan assignment grant/revoke memerlukan platform:manage pada operator role yang sesuai. Usage verification tetap authority operator-accountant. Application token tidak memperoleh management access hanya karena mengetahui ID atau melewati BFF.

Keycloak membuktikan caller; AI Connection adalah model identitas platform terhadap provider. API memvalidasi bearer; BFF memegang session dan tidak menaikkan scope. Local mode menggunakan server-side fixtures. Live Keycloak/environment role mapping tetap perlu deployment evidence. [Principal policy](../../apps/api/src/modules/identity/domain/principal.ts) adalah implementasi, bukan tabel role yang ditebak dari dokumentasi.

Operator scope saat ini platform-wide dalam satu organisasi. Tidak ada fine-grained per-resource approval engine atau multi-organization tenancy yang diklaim tersedia.

## 3. Request key, concurrency, dan response

Resource mutations mengirim Idempotency-Key dan expectedRevision. Command strict menolak field di luar schema. Target id/application berasal dari path pada API baru. Successful resource mutation selalu 200 dengan resource spesifik dan receipt berisi id/key/replayed/completedAt; bentuk ini mengikuti controller, bukan contoh REST generik.

Caller-scoped request key dan canonical command fingerprint diperiksa dalam transaksi yang juga menulis mutation, audit dan completed receipt. Replay same command mengembalikan historical response sebelum memeriksa revision lagi. Command baru dengan revision usang tetap 409. Key berbeda bukan cara aman menyelesaikan unknown acknowledgement; gunakan key semula atau rekonsiliasi state terlebih dahulu.

Window receipt tujuh hari adalah kebijakan lokal yang eksplisit. Expired key menghasilkan 410 REQUEST_KEY_EXPIRED dan tidak dibebaskan otomatis. In-progress claim tetap uncommitted; tidak ada durable lease IN_PROGRESS atau kode 425 untuk mutation ini. [ADR-0029](../adr/0029-replay-resources-runner-authority.md), [repository](../../apps/api/src/modules/control-plane/infrastructure/prisma-m1.repository.ts), [receipt migration](../../prisma/migrations/0005_contract_receipts/migration.sql).

Legacy PUT /api/m1/control-plane tetap CAS-only dan menghasilkan tagged union kind. Penambahan field tidak boleh mengubah variant yang dipilih. Tidak ada automatic retry pada legacy mutation meskipun caller menambahkan header. Client baru memakai operasi resource spesifik.

## 4. Bounded query dan Admin UI yang tersedia

Setiap koleksi mempunyai cursor independen, default 20/maksimum 100 item, consistency live-keyset dan nextCursor. Query melakukan field projection sebelum hasil dibentuk di memory aplikasi; credential secretRef dan outbox payload tidak diambil oleh list baru. Page bytes diperiksa; ini bukan jaminan total process-memory bounded untuk seluruh traffic.

Overview hanya count registries dan observedAt, bukan balance yang dijumlahkan lintas-unit dan bukan atomic snapshot. Legacy full snapshot masih compatibility endpoint yang menolak overflow; console baru tidak memanggilnya. Tidak ada public detail/upload URL yang boleh diasumsikan hanya dari adanya list.

UI sekarang mempunyai tab Overview, Applications, Connections, Profiles, Budgets, Runner fleet, Audit dan Outbox. Connections mengelompokkan tiga koleksi independen; Profiles juga menampilkan aliases; Runner fleet juga menampilkan pools. Pagers dan errors independen. Ini table/read console; API mutation tersedia tetapi CRUD form, plugin manager, approval, live runner health dan execution stream belum diimplementasikan pada UI ini. [Console](../../apps/web/src/features/control-plane/control-plane-page.tsx), [reader](../../apps/api/src/modules/control-plane/infrastructure/prisma-resource-reader.ts).

## 5. Connection dan credential boundaries

AI Connection dapat dedicated atau shared dengan explicit quota-group mapping; binding memeriksa application/profile scope. Credential Instance menyimpan metadata/residency dan dapat menyimpan secret reference internal. Secret value tidak disimpan/dikembalikan oleh management command; list projection juga mengecualikan secret reference. Central/runner-local adalah metadata policy, bukan bukti runtime secret materialization.

Concrete secret manager/workload identity dan rotation belum diintegrasikan. Menambah runner yang merujuk logical account sama tidak otomatis menambah upstream quota.

## 6. Runner authority yang sudah ada

Registration memakai /api/m1/runners/register dengan runner:register. Message berisi id, poolId, version, capabilities, connectionIds dan capacity; environment/region berasal dari pool, bukan arbitrary field tambahan registration. Registrasi memperbarui metadata/lastHeartbeatAt; timestamp itu bukan periodic heartbeat atau proof liveness.

Protocol /api/runner/v1 memisahkan typed reports/evidence dari browser routes. Operator grant/revoke assignment menggunakan Idempotency-Key dan generation precondition. Runner hanya boleh melaporkan dengan exact assignment/owner/execution/attempt/generation/epoch. GRANTED, STARTED, RESULT_PROPOSED, FENCED adalah assignment states, bukan lifecycle akhir AI.

DRAINING menolak grant baru; DISABLED menolak report authority. RESULT_PROPOSED tetap memegang capacity sampai authority diselesaikan. Result proposal tidak mempromosikan artifact atau memfinalisasi execution. Stale usage dari assignment dikenal masuk QUARANTINED dan tidak langsung mem-post ledger. [Runner source](../../apps/api/src/modules/control-plane/infrastructure/prisma-runner-authority.ts).

## 7. Target yang belum berjalan

Automatic placement, Redis heartbeat/lease/epoch coordinator, sandbox launch/termination, plugin registry/materialization, optional workspace/MCP, provider credential injection, artifact promotion dan live inference adalah target P2/P3. DB mengizinkan beberapa lifecycle values untuk fondasi berikutnya; itu bukan bukti service transition atau derived OFFLINE detector sudah tersedia.

Future placement perlu compatible runtime, verified credential locality, capacity, region/data/version policy, dan upstream quota. Manual grant saat ini melakukan subset checks yang dijelaskan di source; jangan mendokumentasikannya sebagai full scheduler.

## 8. Verification

Receipt concurrency/replay/rollback/expiry, projection/cursor, exact fencing, proposal dedup, restart, concurrent grant/revoke dan capacity sudah mempunyai local integration coverage. Browser tests membuktikan independent pagination/error serta absence of legacy snapshot calls. Lihat [execution evidence](../reviews/CONTRACT-EXECUTION.md), [gate scope](../testing/ACCEPTANCE.md), dan [docs synchronization](../reviews/DOCUMENTATION-SYNC.md).
