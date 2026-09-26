# D13–D15 — Admission, Settlement, dan Late Usage

**Implementation boundary — 24 September 2026:** PostgreSQL admission, reservations, ledger and inbox/outbox have local tests. Redis projections and automated late-evidence verification in these target flows are not implemented; runner evidence currently enters quarantine. See [I01–I04](10-implemented-contracts.md) and [current state](../implementation/CURRENT-STATE.md).

**Authored corrected flows.** Financial authority: [ACCOUNTING](../data/ACCOUNTING.md), [ADR-0007](../adr/0007-durable-accounting.md), [ADR-0008](../adr/0008-late-usage.md). Redis tidak menjadi satu-satunya saldo/hold.

## D13 — Atomic admission tanpa mutasi pada denial

```mermaid
sequenceDiagram
    participant A as Calling app
    participant C as Admission service
    participant DB as PostgreSQL
    participant D as Dispatcher or gateway
    A->>C: Submit with idempotency key
    C->>DB: Begin transaction and claim unique key
    alt Existing key and same digest
        DB-->>C: Prior execution and hold
        C-->>A: Same execution reference
    else New logical request
        C->>DB: Lock budget scopes in stable order
        C->>DB: Check posted charges and outstanding holds
        alt Insufficient capacity
            DB-->>C: Reject without changing balance or hold
            C-->>A: 429 budget exhausted
        else Allocation available
            C->>DB: Create execution and reservation, update hold, write outbox
            DB-->>C: Commit confirmed
            C-->>A: Accepted execution ID
            D->>DB: Consume durable dispatch intent idempotently
            D->>D: Invoke only after committed admission
        end
    end
```

Diagram menunjukkan transaction grouping, bukan menahan transaksi selama provider call. Case key sama dengan digest berbeda adalah 409 conflict, tidak ditampilkan untuk menjaga fokus flow.

## D14 — Settlement atomic dan projection idempotent

```mermaid
sequenceDiagram
    participant W as Gateway or worker collector
    participant V as Evidence verifier
    participant DB as PostgreSQL
    participant O as Outbox relay
    participant R as Redis projection
    W->>V: Usage evidence with source identity and revision
    V->>DB: Store bounded evidence and deduplicate
    V->>V: Verify attribution, coverage and cost basis
    alt Evidence complete enough for posting
        V->>DB: Begin settlement transaction
        V->>DB: Unique posting command, append charge or adjustment
        V->>DB: Update residual hold and account revision, write outbox
        DB-->>V: Commit settlement or partial posting
        O->>DB: Read pending projection event
        O->>R: Apply absolute account state with revision
        R-->>O: Applied or duplicate ignored
    else Incomplete or disputed
        V->>DB: Keep pending or quarantine and residual exposure
    end
```

Crash sesudah PG commit sebelum Redis update diselesaikan oleh outbox replay. Duplicate event tidak mengembalikan saldo dua kali. Partial usage tidak menyebabkan seluruh hold dilepas.

## D15 — Late usage dan adjustment setelah fast-path window

```mermaid
flowchart TD
    E[Usage evidence received] --> AUTH[Authenticate source and validate attribution]
    AUTH --> BAD{Invalid or conflicting evidence?}
    BAD -->|Yes| Q[Bounded quarantine with reason]
    BAD -->|No| AGE{Within automatic verification window?}
    AGE -->|Yes| V[Verify source, dedup and completeness]
    AGE -->|No| Q
    Q --> REVIEW[Trusted lookup or authorized audit review]
    REVIEW --> OK{Verified economic evidence?}
    OK -->|No or insufficient| HOLD[Remain disputed or reject with audit reason]
    OK -->|Yes| POST[Idempotent charge or adjustment transaction]
    V --> COMPLETE{Sufficient closure evidence?}
    COMPLETE -->|Yes| POST
    COMPLETE -->|Partial| PART[Post known delta and retain residual hold]
    POST --> LEDGER[Ledger and revisioned account projection]
    PART --> LEDGER
    LEDGER --> REPORT[Expose source, basis, completeness and as-of]
```

Neither fast-path nor audit path restores stale-worker authority. Candidate 15-minute window controls verification routing, not whether a real provider charge exists. Execution result remains unchanged by financial adjustment.
