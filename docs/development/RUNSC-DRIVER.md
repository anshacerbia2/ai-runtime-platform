# gVisor lifecycle driver checkpoint

**19 October 2026: experimental M3 implementation, not production activation or O03 approval.** [`RunscSandboxDriver`](../../apps/runner/src/runsc-sandbox-driver.ts) implements the `SandboxDriver` accepted by `LocalSandboxSupervisor` and `RunnerWorkerOptions.driver`. The driver delegates provisioning, durable reservation, CLI execution and kernel observation to an explicit trusted `RunscSandboxHost`. There is no default production host. Plugins cannot implement this boundary or supply bundle paths, raw OCI specs, runtime flags or host process IDs.

## Launch and ownership

The sandbox name is a deterministic SHA-256 of the assignment ID. The full execution/attempt/runner/owner/boot/generation/epoch binding is checked against both the recorded reservation and fresh OCI annotations. Changing boot or epoch cannot select a new sandbox name for the same assignment.

The host must have exclusive ownership, with no overlap against a previous owner's pending creation. It must atomically persist a reservation and immutable verified bundle before execution. It must retain every reservation, including failed or unused launches, without eviction or name reuse. Partial/uncertain writes fail closed. Production filesystem ownership, lock takeover, image provenance and crash durability are obligations of the future host implementation; an interface does not prove them.

Only a fresh reservation can spawn. An existing reservation returns a recovered handle even if the runtime has disappeared; it never causes another `run`. A missing stop lookup also seals the assignment locally. Reserve/spawn errors remain cached. A prepared handle survives failed startup for explicit recovery; supervisor stop also schedules exact-bound recovery cleanup after a rejected launch, while preserving the original `UNCONFIRMED` evidence. The driver retains at most 256 identities over its lifetime without automatic retirement.

Supervisor passes a `SandboxLaunchGuard` checking drain, stop intent and caller authority. The driver checks it after asynchronous preparation, immediately before `host.start`, which must initiate attached `runsc run` synchronously without an intervening await/queue and retain its monitor even on child startup failure. The host resolves `ready` only after exact running observation or confirmed fast successful exit. A monitor merely exiting with a nonzero CLI status is not startup proof; the fixture rejects that unobserved startup after the monitor is reaped. Creation stays pending so a supervisor stop also handles a late launch. No premature readiness timeout rejection may discard that tracking. Host CLI observations/signals/cleanup need deadlines; stalled operations remain uncertain and cannot free capacity.

## Stop evidence

Signals address all guest processes through fixed `kill --all`. TERM/KILL acknowledgement, numeric monitor status, missing runtime state and an empty cgroup are each insufficient on their own. Termination requires a trusted delete, an empty entire owned cgroup subtree including runtime helpers, and fresh runtime absence. Cleanup must also be rooted in the original reaped monitor or an exact observed started binding.

A verified running/paused/stopped binding may disappear during attached teardown; delete and independent kernel inspection remain required. Fresh recovery that immediately finds missing state without that observation or monitor remains `UNKNOWN`, producing supervisor `UNCONFIRMED`. A created-but-not-started observation does not establish the same witness. Runtime failures and foreign bindings cannot authorize a signal or successful inspection.

This is local termination evidence only. It does not verify an agent result, resolve remote effects, finalize execution, settle usage, retire journals or authorize retry/reassignment.

## Evidence and limits

Cross-platform behavioral tests cover reservation-before-spawn, concurrent retries, full identity rejection, recovery/no-rerun, monitor loss, CLI failure, lingering children, bounded lifetime capacity, pending creation and authority/stop/drain races during preparation. They run through `npm run test:unit`.

The Linux `gvisor-conformance` job builds the runner and composes the real driver and supervisor with pinned real `runsc`, using fixed inert BusyBox bundles. Additional cases cover a new driver reading a fsynced reservation and stopping the same sandbox without rerun; TERM-ignoring parent/child forced stop; fast ordinary exit with the attached monitor; and a missing guest executable whose failed startup retains cleanup, no-rerun and `UNCONFIRMED` evidence. The original runtime policy/isolation/resource-cap experiments remain in the same probe. [Linux recipe and policy](../security/SANDBOX-EVALUATION.md#linux-vmvps-experiment).

The only host implementation is a single-owner disposable fixture. Marker/config fsync and replacing a driver object are **not** a production disk journal, hard process/node-crash test, lock-takeover protocol, image verifier or full worker/shared-store lease-fence integration. No Claude SDK, provider call, credential injection, payload/plugin execution or broker egress is activated. GitHub-hosted Linux evidence does not substitute for the intended VPS.

Next dependencies: production host reservation/lock/recovery and verified immutable image with bounded I/O; Claude compatibility/runtime bridge; scoped payload/plugin/credential handoff; broker egress; actual VPS and hostile/crash/lease-fence gates. O03/O14/O06 remain open. ADR-0011 and the approved architecture are unchanged.
