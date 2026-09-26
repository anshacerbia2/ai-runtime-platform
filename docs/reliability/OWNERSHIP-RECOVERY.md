# Ownership, Lease, Fencing, dan Recovery

**Design baseline 0.2.** Source principal: Redis heartbeat 5s/TTL 15s dan fencing; amendment: conditional renewal, durable authority transitions, quarantine, dan explicit cross-store limitations. [ADR-0005](../adr/0005-leases-fencing.md).

## Implemented kernel versus target recovery

Sejak ADR-0029, manual grant/revoke/report dan typed evidence intake tersedia di source. [PrismaRunnerAuthority](../../apps/api/src/modules/control-plane/infrastructure/prisma-runner-authority.ts) mengunci execution row, memeriksa exact token owner/generation/epoch, memeriksa runner eligibility/capacity, menyimpan assignment dan mempertahankan late evidence dalam quarantine. Revocation menambah generation barrier sebelum old reports ditolak; future generation tidak dipercaya. Result proposal bukan finalization execution.

Yang belum ada: Redis runner lease proof/renewal, reaper, coordinated epoch rebuild, process supervisor, autonomous reassignment, sandbox termination dan actual provider effects. Registration lastHeartbeatAt bukan periodic heartbeat implementation. Manual authority code tidak memanggil Redis untuk mengecek lease; aturan Redis di bagian target tetap persyaratan untuk runtime yang belum aktif.

Bagian 1–9 berikut menggambarkan recovery target. Jangan menjadikannya runbook untuk service Redis/worker yang belum diimplementasikan. Local tests membuktikan authority kernel dan race yang dicakup, bukan full G04–G06 chaos. [Current state](../implementation/CURRENT-STATE.md), [as-built I04](../diagrams/10-implemented-contracts.md).

## 1. Authority model

PostgreSQL menyimpan execution current attempt/generation, assignment owner, coordination epoch, revision, status, cancel intent. Monotonic generation dialokasikan pada durable assignment/revocation; tidak berasal dari counter Redis yang bisa hilang. Worker tidak punya write credential database.

Redis menyimpan short-lived lease proof untuk assignment: execution/attempt, worker, generation, epoch, random nonce. Heartbeat renewal tidak melakukan periodic PostgreSQL row updates. Key access hanya melalui supervisor/lease service; sandbox tidak boleh menulis lease sendiri.

**Safety definition:** setelah revocation/fence transaction committed, old generation tidak bisa commit official result/state atau admit tool mutation baru. Redis expiry merupakan suspicion/lease-validity signal, bukan atomic cross-database authority transition. Explicit finalization dan revocation berkompetisi di PostgreSQL revision/CAS.

## 2. Assignment protocol

1. Durable accepted execution/outbox tersedia dan admission masih sah.
2. Dispatcher claims work secara bounded, mengalokasikan attempt + generation + owner + coordination epoch di transaksi. Duplicate dispatch message membaca assignment yang sama atau no-op.
3. Lease service memasang key `NX` dengan token exact untuk assignment. Worker start menunggu assignment/lease cocok dan no cancel. Gagal menyiapkan lease tidak memicu unowned execution.
4. Worker reports start; control plane mencatat discrete RUNNING transition dan event. Tidak hanya dua write DISPATCHED/FINAL: durable cancellation, revocation, invocation intent, dan financial events tetap diperlukan.

Crash antara assignment dan lease/start menghasilkan PREPARED/DISPATCHED orphan yang direconcile. Repeated setup menggunakan assignment ID, bukan memulai banyak process. Launch operation sendiri perlu idempotent sandbox identifier/inspection.

## 3. Conditional renewal

```text
Atomic operation on Redis:
  current = GET(lease_key)
  if current does not exist: return LEASE_LOST
  if current != expected(owner, generation, epoch, nonce): return LEASE_LOST
  extend TTL of existing key
  return RENEWED
```

Pseudocode, bukan script yang dijalankan. Bare `SET ... EX` dilarang sebagai heartbeat karena bisa membangkitkan key hilang. Redis documentation membahas value-match extension serta fencing limitations (R10 pada [SOURCES](../reviews/SOURCES.md)).

Worker memakai local monotonic safety deadline dari renewal response; bila timeout/failure, hentikan dispatch provider/tool baru dan request supervisor cleanup. Tidak mengasumsikan runtime process mati hanya karena heartbeat service berhenti. Bounded in-flight request dapat tetap berjalan/ditagih.

## 4. Finalization dan race

Worker mengirim result proposal dengan assignment/generation/epoch. Control-plane gate memerlukan fresh lease validation serta current durable assignment, lalu melakukan conditional state transaction. Direct DB access worker dilarang. State CAS memeriksa current attempt, generation, revision, terminal/cancel state.

Fresh Redis check dan PostgreSQL commit bukan satu transaksi. Karena itu baseline tidak menjanjikan penolakan berdasarkan nanodetik TTL secara global. Commit yang menang sebelum durable revocation sah pada linearization point; commit sesudah revocation wajib ditolak. Bila strict wall-clock expiry atomicity diperlukan, pilih coordinator/protocol lain melalui ADR dan uji; jangan menyamarkannya sebagai jaminan Redis+PG.

Do not reassign sebelum durable revocation. Quarantine transaction mengubah authority ke FENCED/LOST dan generation barrier, lalu replacement memakai generation baru. Late output tetap candidate/evidence; late usage masuk verifier independen.

## 5. Orphan recovery

Reconciler melakukan bounded scan indexed active assignments dan batch checks Redis leases; keyspace expiry notifications hanya wake-up hint, bukan satu-satunya recovery trigger. Missing lease => inspect/record suspicion => CAS ORPHAN_SUSPENDED + fence => revoke grants/stop sandbox => inspect local termination dan external operations => decide safe retry/pending/manual app reconciliation.

Network pause dapat membuat false suspicion; isolation/retry policy harus aman walau worker lama masih hidup. Per-operation receiver idempotency mengatasi duplicate effects yang sudah melewati boundary; database fencing saja tidak dapat membatalkan remote mutation.

## 6. Redis failover/restart dan epoch

Redis hot state dapat hilang. Runtime control plane mengenali coordination-epoch mismatch/unhealthy sentinel; stop new dispatch, renew/start grants dianggap invalid, reconciliation bootstrap membaca durable active assignments dan menaikkan epoch/fences melalui authorized coordinator sebelum reopening.

Old worker tidak menciptakan missing keys; assignment tidak direkonstruksi sebagai ACTIVE hanya dari worker report. Redis projection dipulihkan dari durable authority; hot stream history yang hilang diberi epoch baru/resync. Provisioning Redis HA/persistence tidak dengan sendirinya menjamin lease linearizability.

Epoch transition adalah operation terotorisasi dan diserialisasi oleh durable control state. Bila failover behavior/epoch detection tidak terbukti pada deployment yang dipilih, production agent dispatch tetap blocked. Availability dikorbankan sementara daripada menebak single ownership.

## 7. Dependency loss matrix

| Dependency                        | New work                                                                   | Existing work/status                                                                                      |
| --------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| PostgreSQL unavailable            | No durable admission, assignment, tool-intent, settlement, or final commit | Serve retained stream best-effort; stop new paid/mutating steps; buffer bounded evidence, reconcile later |
| Redis unavailable/uncertain epoch | No agent lease/start/renew; no new work requiring hot-tier guarantees      | Stop new steps, quarantine; snapshots from SoR; replay unavailable explicit                               |
| Object store unavailable          | No successful result requiring unavailable object                          | Retain candidate state, retry idempotent upload/verify within deadline                                    |
| Provider unavailable              | Route-specific breaker; only safe authorized alternate route               | Mark partial/ambiguous calls accurately, retain exposure                                                  |
| Usage sink unavailable            | No spend that cannot preserve required evidence/admission                  | Bounded durable spool in trusted collector or pause; never drop and assume zero                           |

Direct gateway may continue only when its documented required-dependency set and admission safety remain satisfied; no undocumented bypass route on Redis outage. Define per-profile degraded behavior and test it before production.

## 8. Cancellation dan shutdown

Cancel intent durable, notification is an optimization. Worker/supervisor checks intent before each new step and reacts to signal. Stop spawning, abort upstream where supported, SIGTERM then bounded escalation, inspect process tree/sandbox exit. Report local stop evidence and external/usage uncertainty separately.

Graceful deploy drains admissions/assignments to the old worker pool, preserves in-flight deadline, and never force-kills unrelated sessions. Supervisor ownership independent from client SSE connection. Process signal success is not provider cancellation proof.

## 9. Timing and limits

Candidate H=5s, TTL L=15s, reaper R=5s from principal. Detection under controlled test is bounded approximately by L+R+coordination/scheduling delay from last possible renewal; 20s is nominal component bound, not a universal measured guarantee. Define t0 fault injection, expected latency budget delta, maximum observed and percentiles separately from termination/recovery duration.

Unbounded retry, immediate zombie replacement, and periodic heartbeat UPDATE per worker to PostgreSQL are outside this baseline. Read scans/discrete transactional writes are permitted and capacity-tested.

Tests G04/G05/G06/G23; diagrams [recovery](../diagrams/04-recovery-cancellation.md).

## Fleet placement and node disappearance

Placement authority hanya diberikan ke runner yang eligible pada saat dispatch. Runner registry/liveness tidak menggantikan attempt lease/fencing: node yang hilang memicu removal dari placement set, sementara existing attempt mengikuti orphan quarantine dan durable fencing rules.

Jika logical AI Connection tersedia di runner lain, scheduler baru boleh redispatch setelah recovery policy menyatakan retry aman. Availability credential pada node kedua bukan bukti external provider/tool side effect attempt pertama telah berhenti.
