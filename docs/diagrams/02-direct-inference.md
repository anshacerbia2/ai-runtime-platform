# D04–D05 — Direct Chat dan Structured Generation

**Authored flow.** Kontrak: [API](../contracts/API.md), [profiles](../contracts/PROFILES-ADAPTERS.md). Business job dan plugin tidak diperlukan.

## D04 — Direct streaming chat

```mermaid
sequenceDiagram
    participant A as Chat app or BFF
    participant API as AI Runtime API
    participant DB as PostgreSQL
    participant G as Model Gateway
    participant P as Approved provider
    participant R as Redis replay
    participant U as Usage verifier
    A->>API: POST chat, profile, messages, idempotency key
    API->>DB: Atomic idempotency and budget admission
    alt Denied
        DB-->>API: No financial mutation
        API-->>A: 429 with reason
    else Admitted
        DB-->>API: Execution ID and hold
        API-->>A: Streaming headers and execution ID
        API->>G: Resolved request and invocation context
        G->>P: Inference with approved limits
        loop Partial output
            P-->>G: Delta
            G->>R: Bounded ordered event
            R-->>API: Live event
            API-->>A: SSE delta
        end
        P-->>G: Result and available usage
        G->>DB: Final result and control event transaction
        G->>U: Usage evidence
        API-->>A: Completed event or snapshot
        U->>DB: Verified settlement or pending reconciliation
    end
```

Tidak ada long-agent queue pada direct path. Lost final usage tidak mengubah completed result menjadi failed; exposure tetap pending. Client reconnect menggunakan events GET, bukan POST ulang tanpa key.

## D05 — Structured output routing dan validation

```mermaid
flowchart TD
    I[Typed request and response schema] --> P[Authorize published profile]
    P --> C{Compatible model and route?}
    C -->|No| REJ[Reject unsupported capability]
    C -->|Yes| A[Durable admission]
    A --> ROUTE[Primary route per profile]
    ROUTE --> CALL[Provider invocation]
    CALL --> VALID{Final schema valid?}
    VALID -->|No| FAIL[Failure or explicit invalid result]
    VALID -->|Yes| FIN[Finalize technical result]
    FIN --> APP[App performs domain validation]
    FAIL --> APP
    CALL --> US[Usage evidence for every attempt]
    CALL --> ERR{Failure before committed output?}
    ERR -->|Policy safe and budget available| RETRY[New recorded attempt on allowed route]
    ERR -->|Ambiguous or partial output| STOP[Expose failure and uncertainty]
    RETRY --> CALL
```

Fallback arrow adalah conditional retry, bukan semua failures. Domain validation dan next-step decision tetap di app. Provider-specific schema support diverifikasi saat profile publication.
