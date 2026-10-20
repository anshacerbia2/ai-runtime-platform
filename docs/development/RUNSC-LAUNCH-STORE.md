# Private runsc launch reservation store

**19 October 2026: M3 storage implementation, without production host activation or O03 closure.** [`FileRunscLaunchStore`](../../apps/runner/src/file-runsc-launch-store.ts) supplies asynchronous persistent reservation metadata behind [`RunscSandboxDriver`](RUNSC-DRIVER.md). Real Linux conformance now uses this backend instead of ad hoc marker files. It does not provision/verify an image, execute plugins or implement a production runner host.

## Persistence and bounds

`open` accepts existing canonical, disjoint private Linux reservation/bundle directories owned by the effective UID, and a record cap of 1–256. Other platforms refuse before filesystem access. Root/lock checks use exact device/inode values; operations address the held directory through `/proc/self/fd`. Symlink roots, public permissions and replaced roots/locks fail closed.

`reserve(record, configDigest)` stores strict versioned metadata: full assignment identity, deterministic sandbox ID, exact bundle path under the configured root, and a declared SHA-256 configuration digest. Unknown credential/nonce fields are rejected. This is private plaintext metadata, not an encrypted payload journal. The producer declares the digest; storing it does **not** verify image/rootfs provenance, signature, policy or bundle immutability.

A fresh reservation writes a private exclusive partial, fsyncs contents, creates the final name with a no-clobber hard link, removes the partial and fsyncs the directory before returning `fresh: true`. File fsync alone does not persist the directory entry; see [Linux fsync semantics](https://man7.org/linux/man-pages/man2/fsync.2.html). Lost responses replay exactly with `fresh: false`; binding/config changes conflict. No overwrite, eviction or removal/retirement API exists.

Each file is bounded to 8192 bytes, with at most 256 records and eight admitted operations including active I/O. Async operations are serialized. Close seals intake immediately and drains accepted work before unlock. These are byte/queue bounds, **not** a filesystem latency guarantee: stalled I/O retains ownership. Dedicated host I/O isolation and measured latency remain production work.

Every lookup reopens a private regular single-link file without following its leaf symlink, validates canonical metadata and compares its content fingerprint. Missing, mutated, malformed, oversized, hard-linked or unexpected files poison storage. Partial writes and uncertain errors retain metadata and lock for explicit inspection. Ordinary capacity/conflict denials do not poison valid storage.

## Ownership and recovery

Exclusive `writer.lock` uses a random session, with no PID/TTL takeover. A stale lock refuses open. Failed recovery preserves the lock; there is no automatic unlock or application recovery endpoint.

Clean reopen with any retained records sets `recoveryRequired: true`: reads and exact replay remain available, while **all fresh assignments** are denied. No reset or automatic retirement exists. Runtime absence cannot erase a reservation or permit reexecution; a recovered handle is for inspection/cleanup, not permission to restart agent/provider work.

The storage lock does not prove that an old sandbox or pending monitor creation stopped. Host composition must stop/reap creation, inspect the entire owned runtime tree and retain uncertainty before ownership transfer, holding storage ownership throughout. An empty directory represents a separately authorized fresh installation; recreating directories after disk loss is not recovery. Restore, old-node resurrection and retirement still require fencing and operational proof.

## Evidence and remaining gates

The [live-owner crash experiment](NATIVE-CGROUP-OWNER-CRASH.md) now SIGKILLs a process holding this store while real runsc and its sandbox are running. Reopen refuses the unchanged stale lock before any new runtime path. The fixture separately cleans the exact runtime, native cgroup subtree and original monitor lifetime; the stale lock still refuses reopen afterward. This adds live-orphan refusal evidence without implementing production unlock/takeover or retirement.

Cross-platform tests cover strict schema/path/digest binding and unsupported-host refusal. Linux tests cover concurrent reserve/conflicts, replay, lock exclusion, close/intake ordering, capacity/backpressure, corrupt/partial/link files, metadata drift, root replacement and no-clobber append. A child is SIGKILLed after durable reservation and before any runtime launch; its stale lock denies reopen. Only after the fixture reaps that exact child and knows it never launched a runtime does it remove its owned lock. Reopen retains the record, denies fresh work, and driver replay cannot call `start` or infer termination from absence.

That test-only removal is **not** a production unlock protocol or live-orphan recovery proof. Separately, the Linux gVisor probe composes real storage/driver/supervisor/runsc, reaps monitors and checks owned-tree cleanup before clean storage reopen/no-rerun. Neither test proves power-loss durability, disk-full behavior, network filesystems, volume/node loss, hostile storage administrators, actual VPS compatibility or full worker/shared-store fencing.

The [pinned bundle producer](VERIFIED-RUNSC-BUNDLES.md) now supplies content-verified config/rootfs artifacts before reservations. Production approval/provenance remains separate. Next: native host lifecycle/recovery, Claude compatibility/runtime bridge, scoped inputs/credentials and broker egress. O03/O06/O14 remain open; production retention/encryption are not inferred from bounded local retention. No API, migration or ADR change.
