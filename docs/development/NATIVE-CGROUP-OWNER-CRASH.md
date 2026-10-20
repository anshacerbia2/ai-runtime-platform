# Native cgroup evidence and live owner crash

**20 October 2026: experimental M3 evidence, not production host activation or O03 closure.** [`RunscCgroupInspector`](../../apps/runner/src/runsc-cgroup-inspector.ts) now supplies the kernel-inspection port in [real driver conformance](RUNSC-DRIVER.md). The probe also SIGKILLs an owner process while its sandbox and attached monitor are live. ADR-0011 and the approved architecture remain unchanged.

## Native read boundary

`open()` accepts no path/PID overrides. Linux is required before filesystem access. It holds the canonical `/sys/fs/cgroup` directory FD, checks root ownership/mode, exact device/inode and the cgroup2 filesystem magic. Each query derives the fixed `airt-runner-…` path from a validated assignment identity. No-follow opens and FD-relative interface reads reject aliases/replaced roots, symlinks and another filesystem. The caller must provide the same trusted host mount/cgroup namespace used by runsc; this does not discover or certify an arbitrary container's global host view.

The supported group type is `domain`. The reader checks `cgroup.events` before and after reading `cgroup.procs`. The kernel's `populated` bit covers live tasks throughout the group and its descendants, so an empty parent PID list cannot hide a populated child. It does not recursively enumerate arbitrary directory trees. [Kernel population semantics](https://docs.kernel.org/admin-guide/cgroup-v2.html#un-populated-notification).

Type reads are limited to 32 bytes, each events read to 1024 bytes, and the direct PID list to 65536 bytes. Strict parsers reject malformed/truncated/duplicate/unknown event fields and invalid PID lists; kernel PID duplicates are accepted as nonempty. Threaded/invalid group types, permission/IO errors and missing interface files in an existing group fail closed. Only a missing target directory under the freshly validated cgroup2 root counts as absent. Four reads may be admitted including active work; operations are serialized and excess intake rejects without a queue. Failure seals the inspector; close drains accepted reads and closes its FD.

These are bounded snapshots, not an atomic guarantee against a new creator or process migration. The host must prevent late creation/name reuse and retain exclusive ownership. Kernel population omits zombie processes; original monitor reaping remains separate. No PID is returned or signalled, no cgroup is created/mutated by the component, and an empty result is not a stop receipt, unlock, completion or retry grant. [Kernel process/reaping semantics](https://docs.kernel.org/admin-guide/cgroup-v2.html#processes).

## Real kernel and crash experiments

The opt-in [gVisor probe](../../scripts/probe-gvisor.mjs) now uses the native inspector in the driver port, while retaining its independent recursive fixture check during cleanup. A new kernel case creates a uniquely owned nested hierarchy, places a short-lived trusted host test helper only in its child, and confirms that empty parent `cgroup.procs` still yields nonempty subtree evidence. The helper has memory/pids/CPU limits; the fixture reaps it and removes only those two owned cgroup directories. It is not an agent/plugin host-execution path.

[`gvisor-owner-crash-child.mjs`](../../scripts/lib/gvisor-owner-crash-child.mjs) owns a separate private launch store, verified bundle producer and native process client. It fsyncs the reservation, starts only the pinned inert forced-stop program and acknowledges exact running state. The parent identifies that owner's original attached monitor through private child metadata and [PID/start-time observations](https://docs.kernel.org/filesystems/proc.html), then SIGKILLs only the owner child handle.

After owner reaping, the probe requires the original monitor and exact-bound running sandbox to remain live and native kernel inspection to remain nonempty. Reopen fails on the durable stale lock before any new runtime path is reached. Lock bytes, reservation and bundle config remain unchanged, and exactly one sandbox has the assignment name. This proves a live-orphan refusal boundary rather than clean-close reopen or a pre-spawn crash.

The disposable parent then performs explicit host-admin cleanup of the already observed binding: all-process KILL, forced delete, native empty-subtree and fresh runtime absence. It also requires the original monitor's exact PID/start-time lifetime to disappear; it sends no numeric PID/group signals and does not invent the lost monitor's exit code. A zombie is still present until PID 1 reaps it. Stale lock refusal and unchanged lock/reservation bytes must still hold **after cleanup**. Only then may the probe remove its disposable workspace. Cleanup failure retains the workspace and fails the gate; it never enables production unlock or fresh work.

## Scope and next dependencies

`npm run test:unit` covers strict evidence parsing, native unsupported-host refusal and Linux cgroup2 read/admission/close behavior. The `gvisor-conformance` job runs the nested-process and live-owner crash cases against real pinned runsc on the same commit. Windows skips native kernel cases explicitly.

This is not a complete production `RunscSandboxHost`, automatic takeover, durable fencing/retirement protocol, worker/shared-store integration, node/power/volume-loss proof or intended-VPS approval. Native ownership/close composition, explicit operational recovery, trusted release/credential delivery, Claude bridge and broker egress remain dependencies. O03/O06/O14/O15 stay open. Local cleanup does not reconcile remote effects, settle accounting or authorize reassignment.
