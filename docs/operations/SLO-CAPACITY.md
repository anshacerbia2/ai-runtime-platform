# SLI, SLO, Capacity, dan Parameter Register

**Baseline 0.2.** Candidate parameters tidak sama dengan measured production guarantees. Principal menyediakan 5s/15s/5s, 10-minute stream window, dan 15-minute fast-path late usage; hardware/load/retention policy produksi tidak diberikan.

## 1. Measurement definitions

| SLI | Definisi | Target status |
| --- | --- | --- |
| Admission availability | Authorized eligible requests yang berhasil durably admitted / eligible requests; policy/rate denial dipisah | O04: target/window belum ditetapkan |
| Gateway overhead | Platform processing/queue time, upstream wait diukur terpisah | Baseline diperlukan; bukan otomatis P99 <20ms |
| End-user TTFT | Dari app request sampai first useful model delta | Per-app target; termasuk network/provider |
| Queue delay | Accepted timestamp -> attempt start per workload class | Per-pool target |
| Failure detection | t0 injected failure -> durable orphan/quarantine transition | Controlled candidate L+R+delta |
| Local termination | Cancel/quarantine command -> verified sandbox stopped | Sandbox-specific target |
| External reconciliation | Unknown operation -> verified outcome atau escalation | Per tool/provider capability |
| Usage completeness | Complete/partial/unknown invocation coverage + age | Separate from charge discrepancy |
| Charge discrepancy | Difference on matched provider source, period, currency and units | Not applied to estimates as if invoices |
| Budget correctness | Denial leaves held balance unchanged; duplicate settlement no double-credit | Exact fixture invariant |
| Isolation | Cross-scope accesses/unauthorized tool calls denied in test | Safety gate, bukan percentile SLO |

## 2. Candidate configuration

| Parameter | Candidate/source | Required closure |
| --- | --- | --- |
| Worker heartbeat H | 5s, principal | Prove renewal/failure behavior at target load |
| Lease TTL L | 15s, principal | Monotonic local deadline margin and GC/network tolerance |
| Reaper scan interval R | 5s, principal | Bounded scan capacity and coordination delay delta |
| Nominal detection | L+R = 20s before scheduling/network delta | Record t0 and measured max/P95/P99, not universal exact bound |
| Stream age retention | 10m, principal | Byte/event cap; advertise actual earliest cursor |
| Late worker fast-path | 15m, principal | Arrival clock/proxy and quarantine adjustment path |
| Max turns example | 15, principal example | Profile-specific bound and envelope coverage |
| SSE keepalive | Deployment-specific | Must be below actual proxy idle timeout; not an arbitrary universal interval |
| Artifact/transcript retention | Not fixed | Class/owner policy, deletion and backup effects |

Other limits must be populated before production: request bytes, prompt/schema complexity, upload bytes, output size, active streams, per-subscriber queue, per-execution replay bytes, process count, CPU/RAM/disk, tool runtime, overall deadline, max attempts, and quarantine intake. Missing value is a launch blocker, not unlimited permission.

## 3. Capacity model (planning, bukan benchmark)

Replay memory roughly `active_streams * emitted_bytes_per_second * effective_retention_seconds + indexing/replication overhead`, bounded by per-execution/tenant quotas. A 10-minute age promise can require too much memory without byte cap; retention contract must expose eviction.

Gateway capacity depends on concurrent streams times per-stream buffers plus admission/normalization cost. Worker capacity depends on resource envelope per runtime and max concurrency. Ledger write load depends on invocations/control events/settlement, not every model token. Budget account hot-row contention measured separately from stream tier.

Queue burst tests include one tenant monopolizing agent capacity while interactive traffic continues. Provider quota is another shared bottleneck even when local workers scale. Cache/route fallback must not bypass data/profile policy under load.

## 4. Dashboards dan alerts

Display admitted/denied by reason, active/queued by workload class, route error/TTFT, oldest outbox item, lease renewal failures, orphan age, stale-write rejections, unresolved external operations, held/posted/overage, unknown-usage age, stream eviction/reset, artifact cleanup backlog, and sandbox policy denials.

Low-cardinality labels: workload class, adapter version, region/pool, error category. Execution/process/actor IDs belong in traces/ledger lookups, not unbounded metric dimensions. Sampled traces tidak menggantikan unsampled financial/control records.

Alert thresholds and notification routing need named owners and rehearsal at P3.5. Distinguish provider incident from internal saturation; do not page on expected policy denials as availability failures.

## 5. Evidence discipline

Every load/fault run records build/runtime/provider versions, environment, seed/fixture, load mix, concurrency, time window, dependencies, observed distributions, failure cases, and raw evidence refs. Report partial/unknown data explicitly. No statement of 100% financial accuracy from one five-minute late-event example.
