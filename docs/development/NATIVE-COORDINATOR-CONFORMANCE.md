# Native worker with real coordinators

**20 October 2026 — M3 integration gate, not production activation.** [`native-worker-coordinator.integration.ts`](../../tests/m3/native-worker-coordinator.integration.ts) combines two real API processes, shared PostgreSQL/Redis, the real worker/driver/host and pinned gVisor with kernel cgroup inspection. It extends the [worker lifetime component proof](NATIVE-RUNNER-WORKER.md); coordinator replies, clocks, activation and cancellation in this gate are real. The guest program and trusted runtime callback remain inert fixtures. No provider, Claude SDK, payload/plugin execution, KMS or credential delivery is activated.

## Covered scenarios

1. A committed claim ACK is deliberately dropped. The worker polls with the same boot, activates one assignment/nonce, and starts one real sandbox. After API A exits, a step preflight through API B preserves that boot/generation/nonce. Explicit worker shutdown requires the original monitor REAPED, trusted runtime deletion, fresh absence and an empty kernel subtree before ownership release. One assignment/attempt/run and held cost remain; shutdown is not completion or settlement.
2. Cancellation commits through API B while an inert callback is already in flight. The next preflight through API A rejects before another callback runs and closes the assignment context. The real sandbox is stopped and inspected. The earlier inert callback may still return its receipt; late unknown-cost evidence is quarantined through the peer without rewriting unknown cost, proposing a result or settling the hold. Process termination is not proof of rollback of external effects.
3. The fixture deletes only its own execution's real Redis lease. Renewal/preflight through API B cannot recreate it, and the native sandbox stops. The real coordinator reaper fences PostgreSQL authority: assignment FENCED, attempt ORPHAN_SUSPENDED/FENCED with external UNKNOWN, execution RECONCILING and held units PENDING_RECONCILIATION. A fresh worker boot with a separate fresh native namespace can heartbeat/claim but cannot obtain replacement work. No second run, official result, usage observation or ledger settlement is created. Late evidence remains stale/quarantined.

The native adapter wraps only the trusted host port to retain reservation identities and original monitor promises/counts. It does not replace worker HTTP, runsc transport, reservation/bundle verification, kernel inspection, PostgreSQL/Redis behavior or coordinator responses. Initial source bytes and runsc entrypoint are pinned; CI verifies the complete published gVisor package checksum as well. These fixture pins are not production release provenance or image approval.

## Isolation and cleanup

[`workerFixture`](../../tests/m3/worker-coordinators.fixture.ts) seeds random scoped application/runner/execution rows, starts the compiled full API composition on two loopback ports and proxies HTTP for explicit ACK loss/peer selection. The optional native worker factory requires a fresh matching driver/host for every boot; it cannot silently use the default fake driver for replacements. Existing fixture-driver HTTP tests still run separately.

Each native worker receives its own private reservations/bundles/state layout under a unique owned temporary workspace. The fixed approved BusyBox program runs with the existing readonly rootfs, unprivileged guest UID, no inherited host credentials, no network and fixed resource limits. Host-side test authentication/database settings do not enter guest argv/environment/mounts. Synthetic encrypted-envelope metadata is enough for placement; this test does not fetch/decrypt a real payload.

Tests compare the full live runtime annotation against the real grant plus worker boot. Clean-close assertions independently check original monitor reaping, runtime absence, empty whole cgroup, retained reservation/config digest and removed writer lock. Cleanup first closes workers, addresses only tracked exact bindings, and never signals numeric host PIDs or deletes untracked runtimes. It only unmounts the exact owned empty-network cache after runtime/subtree cleanup. Recursive temporary-workspace removal requires a canonical checked parent/prefix. Uncertain ownership, LOST monitor or failed cleanup retains the workspace and fails the gate; no automatic unlock/retirement/retry is added.

Database cleanup is scoped to the fixture's random identities. Redis cleanup deletes only that execution lease and runner presence; there is no FLUSHDB or global epoch reset. The native step uses a separate disposable Redis database from the other quality suites.

## Running the gate

Windows and unprivileged/unsupported hosts refuse before filesystem/database mutation. Use an explicitly disposable Linux 5.6+ x64 root host with writable cgroup2, approved runsc package/BusyBox bytes, compiled API/runner/contracts, migrated disposable PostgreSQL and Redis, the normal M0 API environment, `M3_WORKER_HTTP_DISPOSABLE=1` and `M3_COORDINATION_REDIS_URL`. Then run:

```sh
npm run test:runner:native -- --disposable-linux-host /approved/gvisor/runsc /bin/busybox
```

The wrapper accepts only that exact invocation shape and fixed test file. It installs no dependencies, creates no database, starts no provider, and has no host-process fallback. On CI the existing `quality` job installs the checksum-pinned package, runs the gate as root with an explicit environment allowlist, and continues through S3/contract/browser/audit checks. Both Linux jobs use Ubuntu 24.04 to keep the approved inert guest byte pin on the same distribution baseline. The separate `gvisor-conformance` job still runs all prior component/containment cases.

This gate covers real shared-store authority loss across two local API processes and one native worker host. It does not prove physical multi-node isolation, Redis failover/marker-loss chaos, hostile sandbox escape resistance, VPS operation, node/disk/power-loss recovery, production identity/KMS/provenance or remote-effect reconciliation. Those gates and O03/O06/O14/O15 remain open. Approved ADRs and automatic-reassignment policy are unchanged. Next is the trusted runtime bridge and scoped payload/plugin handoff, retaining these gates while production runtime/deployment choices remain explicit.
