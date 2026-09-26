# D09–D12 — State, Lease, Orphan, dan Cancel

**Implementation boundary — 24 September 2026:** Full lifecycle, Redis leases and recovery below remain targets. Current manual fencing and cancel-intent storage are implemented; state labels differ from parts of the physical M1 schema and no supervisor kill/restart is implied. See [I01–I04](10-implemented-contracts.md) and [current state](../implementation/CURRENT-STATE.md).

**Authored corrected flows.** Canonical preconditions ada di [LIFECYCLE](../contracts/EXECUTION-LIFECYCLE.md) dan [OWNERSHIP-RECOVERY](../reliability/OWNERSHIP-RECOVERY.md). Diagram menyederhanakan details, tidak menggantikan transaction semantics.

## D09 — Public execution lifecycle

```mermaid
stateDiagram-v2
    [*] --> ACCEPTED: Admission committed
    ACCEPTED --> QUEUED: Agent dispatch pending
    ACCEPTED --> RUNNING: Direct path
    ACCEPTED --> FAILED: Prestart failure
    QUEUED --> RUNNING: Authorized attempt starts
    QUEUED --> TIMED_OUT: Queue deadline
    RUNNING --> COMPLETED: Valid result and finalization CAS
    RUNNING --> FAILED: Explicit failure
    RUNNING --> TIMED_OUT: Execution deadline
    ACCEPTED --> CANCEL_REQUESTED: Cancel intent
    QUEUED --> CANCEL_REQUESTED: Cancel intent
    RUNNING --> CANCEL_REQUESTED: Cancel wins CAS
    RUNNING --> RECONCILING: Ownership or outcome uncertain
    CANCEL_REQUESTED --> CANCELLED: Local stop verified where applicable
    CANCEL_REQUESTED --> RECONCILING: Termination uncertain
    RECONCILING --> QUEUED: Safe retry and admission
    RECONCILING --> FAILED: Execution abandoned with reason
    RECONCILING --> TIMED_OUT: Deadline outcome
    RECONCILING --> CANCELLED: Cleanup verified
    COMPLETED --> [*]
    FAILED --> [*]
    CANCELLED --> [*]
    TIMED_OUT --> [*]
```

Accounting/external reconciliation dapat berlanjut sesudah terminal. COMPLETED tidak menunggu SETTLED. Required external mutation unknown tidak dipromosikan jadi complete.

## D10 — Conditional lease renewal

```mermaid
sequenceDiagram
    participant W as Worker supervisor
    participant L as Lease service
    participant R as Redis
    W->>L: Renew expected owner, generation, epoch, nonce
    L->>R: Atomic compare current value and extend existing TTL
    alt Key exists and exact token matches
        R-->>L: Renewed
        L-->>W: Lease proof with bounded deadline
    else Missing key or mismatch
        R-->>L: Lease lost
        L-->>W: Renewal denied
        W->>W: Stop new steps and request cleanup
    end
    Note over L,R: No SET recreation on heartbeat
```

Routine renewal tidak UPDATE heartbeat PG. Durable authority cutover tetap transaction CAS; Redis TTL bukan atomic global ownership proof.

## D11 — Orphan quarantine dan safe retry

```mermaid
sequenceDiagram
    participant C as Reconciler
    participant R as Redis
    participant DB as PostgreSQL
    participant W as Old supervisor
    participant G as Control plane gate
    participant X as External receiver
    participant A as App owner
    C->>R: Inspect lease for active assignment
    R-->>C: Missing or unhealthy epoch
    C->>DB: CAS orphan state and revoke generation
    DB-->>C: Durable fence committed
    C->>W: Revoke grants and stop sandbox
    W-->>C: Local termination evidence or unknown
    C->>X: Check operation status using stable key
    X-->>C: Committed, failed or unknown
    alt Retry-safe and allocation available
        C->>DB: Create replacement attempt with new generation
    else External outcome unresolved
        C-->>A: Explicit operation refs and uncertainty
    end
    W->>G: Old state proposal
    G->>DB: Conditional state mutation
    DB-->>G: Reject fenced generation
    G-->>W: Stale authority rejected
    Note over W,G: Late usage goes to separate verified evidence intake
```

Old supervisor hanya mengirim proposal melalui control gate; PG interface tidak diekspos langsung ke worker. Remote mutation yang telah terjadi tidak dibatalkan oleh fence.

## D12 — Cancel versus complete

```mermaid
sequenceDiagram
    participant A as App
    participant C as Control plane
    participant DB as PostgreSQL
    participant W as Supervisor
    participant P as Provider or tool
    A->>C: Cancel execution
    C->>DB: CAS durable cancel intent
    alt Completion already committed
        DB-->>C: Existing terminal snapshot
        C-->>A: 200 unchanged terminal status
    else Cancel intent wins
        DB-->>C: Cancel requested
        C-->>A: 202 cancel requested
        C->>W: Signal stop, durable intent remains source
        W->>P: Abort where supported
        P-->>W: Confirmed or unknown remote outcome
        W->>W: Stop process tree and inspect actual exit
        W->>C: Local evidence and external uncertainty
        C->>DB: CANCELLED or RECONCILING with details
    end
```

Signal ACK saja bukan termination proof. Reservation/usage settlement mengikuti exposure, tidak dilepas hanya karena cancel request diterima.
