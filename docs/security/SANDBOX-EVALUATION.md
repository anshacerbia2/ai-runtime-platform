# Sandbox adapter evaluation for M3

**Status: working evaluation, not a technology decision or production approval.** [ADR-0011](../adr/0011-sandbox-security.md) fixes the isolation requirements; [O03](../decisions/OPEN-QUESTIONS.md) leaves the concrete runtime open. This page gives security and runtime owners a repeatable way to choose and verify an adapter. A local `LocalSandboxSupervisor` is only a lifecycle port and does not satisfy this gate.

## Decision inputs

Record these for the actual runner pool before comparing candidates:

| Input                                                                                     | Why it changes the choice                                                                           |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Kubernetes/CRI versus direct VM or bare-metal orchestration; node OS and architecture     | Determines whether a Kubernetes RuntimeClass or a separately managed microVM lifecycle is feasible. |
| Hardware virtualization and nested-virtualization availability on **every** eligible node | Determines whether KVM-backed isolation can run and be recovered after node moves.                  |
| Threat tier of application-owned plugin code and co-tenant data                           | Determines required host isolation and whether sharing a sandbox or node is acceptable.             |
| Claude/agent runtime syscall, filesystem, network, and process needs                      | Determines compatibility under the chosen isolation boundary.                                       |
| Allowed egress, broker endpoints, credential injection, and data region                   | Determines network policy and whether the sandbox can avoid broad secrets.                          |
| Job duration, cold-start budget, memory/CPU/disk/process caps, and concurrent jobs        | Determines measured capacity and denial-of-service limits.                                          |

Do not infer these from local Windows tests or from the existence of a container runtime. In particular, do not install a fallback that silently runs plugin code in the API process or in an ordinary host child process.

## Candidate fit to verify

| Candidate                                 | Useful integration property                                                                                                                                    | Required proof / trade-off                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| gVisor (`runsc`)                          | [Kubernetes RuntimeClass and containerd integration](https://gvisor.dev/docs/user_guide/quick_start/kubernetes/) can preserve a container-oriented deployment. | [Security model](https://gvisor.dev/docs/architecture_guide/security/) and [production guidance](https://gvisor.dev/docs/user_guide/production/) describe syscall interception and workload-dependent overhead. Test actual runtime compatibility and hostile-code containment; the production guide explicitly does not serve as an untrusted-code deployment recipe. |
| Kata Containers                           | [Kubernetes pods can run in a VM-backed boundary](https://github.com/kata-containers/kata-containers/blob/main/docs/design/virtualization.md).                 | Verify [KVM or nested virtualization prerequisites](https://github.com/kata-containers/kata-containers/blob/main/docs/installation.md), guest/image provenance, networking, startup cost, and node-failure cleanup on the intended pool.                                                                                                                               |
| Firecracker with a dedicated orchestrator | A microVM boundary can be managed independently of Kubernetes.                                                                                                 | [Production host guidance](https://github.com/firecracker-microvm/firecracker/blob/main/docs/prod-host-setup.md) requires KVM and a jailer or equivalent controls. The platform would own image, network, lifecycle, discovery, and recovery integration; count that operational scope explicitly.                                                                     |

These are candidates, not ranked defaults. If Kubernetes is the target, compare gVisor and Kata on the same pinned agent/plugin workload and hostile fixtures first. If the runner pool is not Kubernetes, assess the actual orchestration path before treating Firecracker as simpler. No candidate passes because of its product name.

## Common acceptance experiment

For each candidate, record pinned runtime/image/package digests, host/kernel/CRI versions, node topology, applied policy, workload digest, observed behavior, logs, and reviewer disposition. Evidence must be from the deployment shape proposed for production, not only a local fake driver.

1. Launch an exact assignment twice after a response loss and after supervisor restart. The adapter's `recover` lookup must return the full recorded binding and handle for the deterministic sandbox identity; only one owned sandbox may execute. A stale boot, owner, generation, or epoch cannot stop or attach to a different sandbox. The local port has fake-driver tests for this ordering, not a real runtime proof.
2. Try to read host/control-plane environment, service-account material, runtime sockets, arbitrary host paths, and another application's workspace. Test symlinks and mount propagation. The workload must receive no broad host/provider credential.
3. Probe metadata and private/control networks over IPv4 and IPv6, DNS changes, and redirects. Only explicit broker/approved destinations may be reachable. Verify outbound policy at the enforcement point, not through agent SDK prompts.
4. Exercise CPU, memory, process, disk, log, and wall-clock exhaustion. Measure whether neighboring jobs and the control plane remain within their stated budgets.
5. Quiesce new launches while an assignment runs; keep its declared in-flight deadline, then explicitly stop it. Exercise graceful stop, force escalation, supervisor crash, and node loss while child processes and an external operation are active. Inspect the entire owned sandbox/process tree. Record local termination separately from remote effect and usage reconciliation; never authorize reassignment solely from a successful signal.
6. Verify pinned image/package provenance, read-only base, bounded writable workspace, cleanup and retention behavior. Capture startup and steady-state latency/capacity against workload-specific thresholds chosen by the owners.

Map the resulting artifacts to [G18/G19/G24 and recovery gates](../testing/ACCEPTANCE.md). A failure or missing inspection is `UNCONFIRMED`; it does not become a successful stop receipt. Selection also needs the deployment owner, security reviewer, credential agreement, data policy, and recovery plan required by [SECURITY](SECURITY.md).
