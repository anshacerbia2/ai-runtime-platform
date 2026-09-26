# SLI, SLO, Capacity, dan Parameter Register

**Baseline 0.2.** Candidate parameters tidak sama dengan measured production guarantees. Principal menyediakan 5s/15s/5s, 10-minute stream window, dan 15-minute fast-path late usage; hardware/load/retention policy produksi tidak diberikan.

## Implemented safety policy (not measured SLOs)

| Boundary                            | Current code value                                     | Source / limitation                                                                |
| ----------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| Browser unary overall wait          | At most 30,000 ms                                      | One monotonic deadline across attempts/body/backoff; not API/provider cancellation |
| General browser response            | At most 8 MiB                                          | Actual bytes read; not total heap/RSS                                              |
| Error diagnostics                   | At most 64 KiB                                         | Status/correlation survive malformed or oversized diagnostic bodies                |
| Resource page                       | Default 20, maximum 100 items; 1 MiB response envelope | Projection/keyset before materialization; no global concurrency memory guarantee   |
| Resource mutation response          | 64 KiB policy                                          | Historical resource receipt; database also constrains receipt JSON                 |
| Declared replay-safe browser writes | At most 3 total HTTP attempts                          | Other operations remain one attempt; BFF adds no retry                             |
| Per-client retry tokens             | Capacity 10, refill 1 per second                       | Load protection local to client instance, not a shared quota                       |
| Receipt replay                      | 7 days, retained expired keys                          | No cleanup/tombstone deletion job; production retention/calibration open           |
| Runner binding advertisement        | 65,536-byte messages, protocol v1                      | API configured body cap still applies; no streaming transport                      |
| Database JSON validation            | 65,536 bytes by default, depth 32, 10,000 nodes        | Explicit representation validator, not unlimited generic cloning                   |

References: [behavior policy](../../packages/contracts/src/http/behavior.ts), [resource policy](../../packages/contracts/src/http/resources.ts), [retry budget](../../apps/web/src/shared/api/retry-policy.ts), [runner protocol](../../packages/contracts/src/http/runner.ts), [JSON validator](../../apps/api/src/shared/infrastructure/json-value.ts). API/BFF configurable timeouts and limits remain in [configuration](../development/CONFIGURATION.md).

Some database routines use different timeout/retry policies; do not extrapolate the receipted-management budget to every M1 transaction. No p95/p99, cluster memory cap, live TTFT or provider billing accuracy is inferred from these constants. Candidate Redis/SSE parameters below are not active timers.

## 1. Measurement definitions

| SLI                     | Definisi                                                                                                    | Target status                                 |
| ----------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Admission availability  | Authorized eligible requests yang berhasil durably admitted / eligible requests; policy/rate denial dipisah | O04: target/window belum ditetapkan           |
| Gateway overhead        | Platform processing/queue time, upstream wait diukur terpisah                                               | Baseline diperlukan; bukan otomatis P99 <20ms |
| End-user TTFT           | Dari app request sampai first useful model delta                                                            | Per-app target; termasuk network/provider     |
| Queue delay             | Accepted timestamp -> attempt start per workload class                                                      | Per-pool target                               |
| Failure detection       | t0 injected failure -> durable orphan/quarantine transition                                                 | Controlled candidate L+R+delta                |
| Local termination       | Cancel/quarantine command -> verified sandbox stopped                                                       | Sandbox-specific target                       |
| External reconciliation | Unknown operation -> verified outcome atau escalation                                                       | Per tool/provider capability                  |
| Usage completeness      | Complete/partial/unknown invocation coverage + age                                                          | Separate from charge discrepancy              |
| Charge discrepancy      | Difference on matched provider source, period, currency and units                                           | Not applied to estimates as if invoices       |
| Budget correctness      | Denial leaves held balance unchanged; duplicate settlement no double-credit                                 | Exact fixture invariant                       |
| Isolation               | Cross-scope accesses/unauthorized tool calls denied in test                                                 | Safety gate, bukan percentile SLO             |

## 2. Candidate configuration

| Parameter                     | Candidate/source                          | Required closure                                                             |
| ----------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------- |
| Worker heartbeat H            | 5s, principal                             | Prove renewal/failure behavior at target load                                |
| Lease TTL L                   | 15s, principal                            | Monotonic local deadline margin and GC/network tolerance                     |
| Reaper scan interval R        | 5s, principal                             | Bounded scan capacity and coordination delay delta                           |
| Nominal detection             | L+R = 20s before scheduling/network delta | Record t0 and measured max/P95/P99, not universal exact bound                |
| Stream age retention          | 10m, principal                            | Byte/event cap; advertise actual earliest cursor                             |
| Late worker fast-path         | 15m, principal                            | Arrival clock/proxy and quarantine adjustment path                           |
| Max turns example             | 15, principal example                     | Profile-specific bound and envelope coverage                                 |
| SSE keepalive                 | Deployment-specific                       | Must be below actual proxy idle timeout; not an arbitrary universal interval |
| Artifact/transcript retention | Not fixed                                 | Class/owner policy, deletion and backup effects                              |

Other limits must be populated before production: request bytes, prompt/schema complexity, upload bytes, output size, active streams, per-subscriber queue, per-execution replay bytes, process count, CPU/RAM/disk, tool runtime, overall deadline, max attempts, and quarantine intake. Missing value is a launch blocker, not unlimited permission.

## 3. Capacity model (planning, bukan benchmark)

Replay memory roughly `active_streams * emitted_bytes_per_second * effective_retention_seconds + indexing/replication overhead`, bounded by per-execution/application quotas. A 10-minute age promise can require too much memory without byte cap; retention contract must expose eviction.

Gateway capacity depends on concurrent streams times per-stream buffers plus admission/normalization cost. Worker capacity depends on resource envelope per runtime and max concurrency. Ledger write load depends on invocations/control events/settlement, not every model token. Budget account hot-row contention measured separately from stream tier.

Queue burst tests include one application monopolizing agent capacity while interactive traffic continues. Provider quota is another shared bottleneck even when local workers scale. Cache/route fallback must not bypass data/profile policy under load.

## 4. Dashboards dan alerts

Display admitted/denied by reason, active/queued by workload class, route error/TTFT, oldest outbox item, lease renewal failures, orphan age, stale-write rejections, unresolved external operations, held/posted/overage, unknown-usage age, stream eviction/reset, artifact cleanup backlog, and sandbox policy denials.

Low-cardinality labels: workload class, adapter version, region/pool, error category. Execution/process/actor IDs belong in traces/ledger lookups, not unbounded metric dimensions. Sampled traces tidak menggantikan unsampled financial/control records.

Alert thresholds and notification routing need named owners and rehearsal at P3.5. Distinguish provider incident from internal saturation; do not page on expected policy denials as availability failures.

## 5. Evidence discipline

Every load/fault run records build/runtime/provider versions, environment, seed/fixture, load mix, concurrency, time window, dependencies, observed distributions, failure cases, and raw evidence refs. Report partial/unknown data explicitly. No statement of 100% financial accuracy from one five-minute late-event example.

## Fleet and upstream quota capacity model

Capacity runner dan capacity upstream adalah dua dimensi berbeda. Banyak runner dapat menunjuk logical AI Connection/quota group yang sama; node concurrency tidak boleh dijumlahkan sebagai provider quota tambahan tanpa evidence provider.

Capacity planning memantau eligible runner count, active slots, queue/admission latency, connection health, provider rate-limit signals, quota-group saturation, drain/offline events, dan placement failure reasons. Numerical thresholds tetap harus berasal dari measured environment/profile.
