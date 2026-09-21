# ADR-0022 — Distributed Runner Fleet, Discovery, dan Placement

**Tanggal:** 21 September 2026 (Asia/Jakarta)

**Status:** adopted in documentation; registry mulai P1, execution placement P3.

## Context

Runner harus dapat tersebar di banyak server, region, atau worker pool. Server dapat mempunyai runtime dan account AI berbeda; logical AI account yang sama juga dapat tersedia pada beberapa server.

## Decision

Runner melakukan authenticated self-registration dan heartbeat ke satu AI Runtime Platform. Platform tidak melakukan network scanning. Durable runner identity/capability/binding disimpan di PostgreSQL; liveness, lease, dan hot capacity berada di Redis.

Runner mengiklankan node identity, pool, environment/region, runtime capabilities, supported plugin packaging, software version, connection references, dan capacity. Secret tidak dikirim melalui registration/heartbeat.

Placement memilih candidate berdasarkan runtime compatibility, allowed AI connection, credential locality, app/profile policy, capacity, environment/region/data policy, version compatibility, dan runner state.

Runner lifecycle minimal: `RUNNING`, `DRAINING`, `OFFLINE`, `DISABLED`. `DRAINING` menerima nol execution baru. Lease expiry menghentikan placement baru dan memicu reconciliation/fencing untuk in-flight attempt.

Satu logical AI Connection dapat dipetakan ke N credential instances dan N runner bindings. Scheduler mempertahankan upstream quota-group identity agar account yang sama pada beberapa runner tidak dihitung sebagai quota independen.

## Consequences

Platform dapat berkembang dari satu worker ke fleet multi-server tanpa mengubah application execution contract. Admin UI harus fleet-aware dan menampilkan runner, pool, capabilities, connection availability, capacity, heartbeat, drain state, dan active executions.

## Verification

Uji registration auth, stale heartbeat, drain, duplicate node identity, incompatible version, connection locality, shared quota group, failover placement, fencing, dan recovery tanpa double execution.

## Revisit trigger

Revisit bila orchestration pindah ke Kubernetes/Nomad/cloud scheduler; control-plane semantics tetap dipertahankan walaupun discovery implementation berubah.
