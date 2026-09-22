# Deployment dan Operability Blueprint

**Target baseline 0.2, bukan topology yang sudah di-deploy.** [ADR-0012](../adr/0012-deployment-dispatch.md).

## 1. Initial topology

Modular control-plane service; gateway execution pool; agent supervisor/worker pool terpisah; PostgreSQL; Redis hot tier; object store; secret manager; observability collector. Modul tidak semuanya harus microservice. Default implementation language candidate TypeScript untuk reuse runner boundary; keputusan final dicatat O01, bukan requirement bahwa semua app harus berpindah bahasa.

API ingress autentikasi/authorization -> admission -> direct gateway atau durable dispatch. Agent compute tidak menempel pada process API. Network policy memisahkan client ingress, control/storage, sandbox egress, dan provider/tool destinations. Aplikasi mengakses API, bukan Redis/PostgreSQL langsung.

## 2. Durable dispatch pilihan awal

Gunakan PostgreSQL execution/outbox sebagai work authority dan dispatcher yang membaca bounded batches. External queue dapat ditambahkan sebagai delivery optimization; consumer tetap dedup dan claims assignment lewat SoR. Queue delivery at-least-once tidak berarti external effect exactly-once.

Dispatch hanya setelah reservation committed. Claimed attempt punya stable sandbox launch identity untuk duplicate launch recovery. Watchdog/supervisor memverifikasi process existence dan control-plane generation. Provider direct path tetap durably admitted tetapi tidak harus menunggu queue agent.

## 3. Capacity pools

Pisahkan interactive, batch, agent melalui queue/pool/concurrency reservation. Capacity cap per application/profile dan upstream credential binding. Hindari satu global semaphore yang membuat document generation memblok semua chat.

Scale gateway menurut active streams/latency/memory dan pool caps, worker menurut admitted queue age/resource need. Jangan autoscale tanpa memperhatikan provider rate limits dan budget. Storage pool concurrency bounded; tidak menahan DB transaction selama model execution.

## 4. Environment dan dependencies

Dev/staging/prod memakai credentials, databases, object prefixes, Redis namespaces, serta telemetry access terpisah. Production input tidak dipakai dalam tests tanpa authorized anonymization/consent/policy. Package/runtime image pinned dengan digest.

PostgreSQL backup/PITR strategy, Redis HA/persistence, object durability/versioning, region/AZ, replica counts, and secret platform belum ditentukan; lihat O02/O03/O05. Single Redis instance untuk development bukan alasan mengklaim production HA; Redis Cluster juga tidak wajib sebelum kapasitas/availability requirements diketahui.

## 5. Health, readiness, dan shutdown

Liveness memeriksa process responsiveness; readiness memeriksa ability to safely accept relevant workload. DB unavailable berarti no new durable admission. Redis/epoch unhealthy berarti no new agent grants. Provider outage memengaruhi route health, bukan otomatis mematikan seluruh API status read.

Shutdown: stop new admissions/assignments, drain bounded in-flight requests, persist cancellation/cleanup state bila deadline lewat, preserve outbox/evidence, terminate only owned sandbox. Existing SSE may reconnect to another API instance using cursor; sticky session bukan correctness requirement.

## 6. Release dan rollback

Expand-contract database/schema/API changes, mixed-version contract tests, runtime candidate profiles, canary alias, compare quality/usage/errors, rollback alias untuk new work. In-flight execution tetap memakai snapshot pinned; security emergency dapat revoke dengan audit.

Rollback API/runtime tidak boleh mereset idempotency keys, reservations, ledger, atau generations. Restore database memerlukan admission freeze, coordination epoch bump, provider/tool outcome reconciliation, and pending exposure review sebelum dispatch dibuka kembali.

## 7. Operational ownership

Platform team owns service/worker/storage health; app owner owns quality/business workflow and publication; security owns grant/data approval; accounting owner owns reconciliation thresholds/manual adjustments. Person/on-call rotation ditetapkan sebelum P3.5. Runbooks ada di [RUNBOOKS](RUNBOOKS.md); metrics/targets di [SLO-CAPACITY](SLO-CAPACITY.md).

## 8. External-app web delivery

The web application is served on its own public origin and owns its path space from `/`. ATI One lists it in the catalogue and links to that origin; it does not proxy, mount, or frame the app. There is no mount prefix, and no route validates a portal proxy credential. Responses deny framing. See [ADR-0025](../adr/0025-external-app-standalone-auth.md).

Web delivery is two Node processes, deployed together but separable:

```text
ingress -> Next.js (web + BFF) -> NestJS/Fastify (domain API) -> PostgreSQL
```

The Next.js tier is the only public entry. It terminates the browser session, holds the confidential OIDC client, and calls the API server-side with a bearer token. The API remains an OAuth resource server validating JWTs against realm JWKS and is not exposed publicly. Deployment MUST NOT route browsers directly to the API.

Liveness for the web tier checks process responsiveness; readiness additionally requires reachability of the API and of the OIDC discovery/JWKS endpoints, because neither sign-in nor any console read can succeed without them. The API keeps its existing health semantics.

The app uses a dedicated confidential Keycloak client per environment and does not reuse the ATI One portal client. Callback and post-logout URIs are registered under this platform's origin and must match exactly. Rotating the client secret is a web-tier restart, not an API restart. See [Frontend Architecture](../architecture/FRONTEND.md) and [ADR-0026](../adr/0026-nextjs-bff.md).

`docs/` Markdown is a build input for the web tier, so documentation changes require a web rebuild to appear.

## 9. Distributed runner fleet

Deployment awal boleh satu host, tetapi contract target adalah distributed runner fleet. Runner self-register ke Control Plane dan masuk ke Runner Pool; tidak ada network scanning sebagai discovery mechanism.

Node state `RUNNING`, `DRAINING`, `OFFLINE`, dan `DISABLED` mempengaruhi placement. DRAINING menghentikan assignment baru sambil membiarkan in-flight work direkonsiliasi/selesai. OFFLINE berasal dari liveness loss; DISABLED adalah durable operator policy.

Satu AI Connection dapat tersedia pada beberapa nodes. Connection credential dapat central-managed atau runner-local. Placement hanya memilih node yang memiliki compatible runtime + allowed connection + healthy credential binding + capacity + region/data/version policy.

Shared upstream account/project membawa `quota_group_ref`; menambah runner tidak boleh dianggap menambah upstream quota. Autoscaling/Kubernetes/Nomad dapat mengganti mekanisme provisioning, tetapi registry, placement, fencing, dan connection semantics tetap sama.
