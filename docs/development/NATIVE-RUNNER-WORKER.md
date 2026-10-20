# Worker and native sandbox lifetime

**20 October 2026 — M3 opt-in composition, no production activation.** [`openNativeRunnerWorker`](../../apps/runner/src/native-runner-worker.ts) transfers one fresh [native host](NATIVE-RUNSC-HOST.md), its matching driver and their lifetime to one `RunnerWorker`. The factory fixes that pairing internally and bounds worker capacity to the process client's eight concurrent monitor slots. It requires explicit trusted worker/runtime/HTTP and sandbox/image/executable configuration. It installs no operating-system signal handler and reads no environment, credential file or provider key. Failed worker construction retains host ownership.

## Stop, drain and close

Existing `stop()` and `drain(graceMs)` still return bounded assignment stop evidence. Their completion alone never means the original runsc monitors or host descriptors have drained. When a matching `sandboxLifecycle` was transferred, any worker stop also schedules the one host close after assignment cleanup, including fatal heartbeat/bootstrap failure and shutdown-signal paths.

`close(graceMs = 0)` synchronously stops/quiesces intake, optionally honors one non-extensible drain grace period, then awaits assignment cleanup and the host's independent final proof. Concurrent calls share the first close promise and cannot extend grace, reclose the host or reopen the worker. The configured shutdown `AbortSignal` uses this same path. A pre-aborted signal cannot start work. The caller may translate its own process/deployment lifecycle into that signal; no global process listener is installed by the component.

The close result contains the original assignment evidence and `ownership: RELEASED | UNCONFIRMED | UNMANAGED`. RELEASED means only that the transferred sandbox host completed its local close proof. UNCONFIRMED preserves uncertainty if host close failed or an assignment stop/required durable stop receipt was unavailable. Without a transferred host the result is UNMANAGED; a fake driver alone cannot assert ownership release.

Before publishing stop results, the worker captures whether any assignment was UNCONFIRMED or any configured outcome-journal stop receipt was UNAVAILABLE. Such uncertainty passes `retainLock: true` to the host's first close. The host captures that decision before asynchronous work, keeps its lock and rejects close; later ordinary closes cannot downgrade it. Host failure never upgrades or rewrites an assignment stop receipt. Host close may remain pending while original creation/monitor or filesystem work cannot drain; a timeout on the caller's wait is not permission to release storage or retry.

This close does not flush/close the separately owned evidence collector, outcome journal or late result candidates. An uncooperative trusted runtime callback may return later; existing candidate/evidence rules and borrowed-buffer erasure still apply. No result proposal replay, execution completion, remote-effect conclusion, lease revocation, journal retirement or replacement assignment is added.

## Authority ordering

The existing chain remains: exact authenticated heartbeat/claim, exact boot/generation/epoch/nonce activation, monotonic lease gate, supervisor stop/drain guard, driver reservation, then host/process final guarded spawn. Asynchronous bundle preparation does not freeze authority. Expiry, renewal conflict or worker quiesce during preparation denies dispatch even before a delayed watchdog callback fires. Reservations remain retained and a fresh monitor-less absence stays UNKNOWN.

For active work, renewal rejection closes the assignment context and initiates real sandbox stop. `context.runStep` keeps its fresh coordinator preflight before external I/O; a rejected cancel/fence preflight denies the callback. Cooperative abort or local process termination does not prove rollback of already dispatched remote effects. Redis/HTTP failure and missing runtime state do not grant a replacement run.

## Evidence and limits

Behavioral worker/host tests cover stop-before-close ordering, independent pending host close, single close/grace, fatal stop and shutdown signal, retained ownership on unknown stop or journal failure, host close failure without receipt upgrade, final dispatch denial across expiry/renewal/quiesce during preparation, and unmanaged drivers.

The disposable real gVisor job adds five worker cases: signal shutdown reaps before unlock; renewal conflict stops the real sandbox; cancel-preflight conflict denies external dispatch; real bundle preparation crosses the monotonic lease deadline without firing watchdog timers and never calls run; and an original LOST monitor keeps the exact lock after independent cleanup. Three cases use the native factory; preparation/LOST cases wrap trusted component ports only to inject a preparation barrier and retain a run counter/original monitor. File bundles, reservations, process transport and kernel inspection remain real. Guest programs are fixed inert BusyBox fixtures with no provider calls or credentials.

Coordinator replies and timing in these gVisor cases are controlled `fetchImpl`/clock fixtures. Existing PostgreSQL/Redis worker HTTP conformance remains separate. This is not proof of real coordinator cancellation/failover through a native sandbox, multi-node stale-writer rejection, hostile VPS isolation, node/disk-loss recovery or official completion. Next work is a coordinator-backed native-worker gate and the trusted runtime/delivery bridge, with production provenance, identity/KMS, Claude/egress, retention and actual VPS still open. O03/O06/O14/O15 and approved ADRs are unchanged.
