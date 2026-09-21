# D16–D18 — Stream Recovery, Artifacts, dan Sessions

**Authored flows.** Canonical references: [EVENTS](../contracts/EVENTS-STREAMING.md), [ARTIFACTS-SESSIONS](../contracts/ARTIFACTS-SESSIONS.md).

## D16 — SSE reconnect dan explicit resync

```mermaid
sequenceDiagram
    participant A as App streaming client
    participant API as Authenticated stream endpoint
    participant R as Redis replay buffer
    participant DB as Durable snapshot service
    A->>API: GET events with Last-Event-ID
    API->>API: Check execution and cursor authorization
    API->>R: Inspect epoch and earliest retained cursor
    alt Cursor retained
        R-->>API: Events after cursor
        API-->>A: SSE replay then live events
        A->>A: Deduplicate IDs and apply revisions
    else Cursor expired, evicted or epoch lost
        API-->>A: 410 STREAM_RESUME_EXPIRED and snapshot URL
        A->>DB: Authorized GET execution snapshot
        DB-->>A: Current result, state, uncertainty and new stream reference
        A->>API: Optional attach to current stream
    end
    Note over A,DB: Reconnect never dispatches a new inference
```

Snapshot service adalah authenticated API backed by SoR; client tidak membaca database langsung. Jika gap terjadi sesudah SSE headers terkirim, reset event/close menggantikan HTTP 410 yang tidak lagi bisa diubah.

## D17 — Artifact candidate versus official result

```mermaid
sequenceDiagram
    participant W as Authorized producer
    participant API as Artifact service
    participant O as Object storage
    participant F as Finalization service
    participant DB as PostgreSQL
    W->>API: Request scoped upload grant
    API-->>W: Artifact ID and limited upload grant
    W->>O: Upload attempt-scoped bytes
    W->>API: Complete with digest and size
    API->>O: Verify required metadata and readable object
    API-->>W: Verified candidate artifact
    W->>F: Propose immutable manifest with generation
    F->>DB: CAS current authority and result revision
    alt Valid authority and result contract
        F->>DB: Commit official manifest reference, terminal state and outbox
        F-->>W: Finalization accepted
    else Stale generation or invalid result
        F-->>W: Reject promotion
        F->>DB: Track candidate quarantine or cleanup
    end
```

Upload success alone is not execution success. Object upload and PG result commit are separate operations; stable artifact IDs, checksum and idempotent finalization handle the crash window.

## D18 — Scoped single-writer runtime session

```mermaid
flowchart TD
    REQ[Request with optional session reference] --> HAS{Session specified?}
    HAS -->|No| NEW[Independent execution or authorized new session]
    HAS -->|Yes| AUTH[Authorize application, actor and profile]
    AUTH --> VALID{Runtime and version compatible?}
    VALID -->|No| ERR[Explicit incompatible-session error]
    VALID -->|Yes| CAS[Claim writer at expected session revision]
    CAS --> BUSY{Claim successful?}
    BUSY -->|No| CONFLICT[409 session busy or revision conflict]
    BUSY -->|Yes| RUN[Run with pinned checkpoint and profile]
    RUN --> OUTCOME{Result and writer authority verified?}
    OUTCOME -->|Yes| COMMIT[Commit new checkpoint and session revision]
    OUTCOME -->|No| REC[Reconcile writer before any resume]
    NEW --> RUN
    ERR --> APP[App decides explicit restart]
```

Idempotent submission replay returns the original execution before modifying session state. App conversation ID is not itself a resumable runtime session or a grant to another app's history.
