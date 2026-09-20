# D19–D21 — Deployment, Data, dan Trust Boundaries

**Authored target views, not an installed topology.** [DEPLOYMENT](../operations/DEPLOYMENT.md), [DATA-MODEL](../data/DATA-MODEL.md), [SECURITY](../security/SECURITY.md).

## D19 — Initial deployment topology

```mermaid
flowchart TB
    CLIENT[App backend or chat BFF] --> INGRESS[HTTPS ingress and authentication]
    subgraph CP[Trusted service zone]
      INGRESS --> API[API replicas and stream service]
      API --> GW[Interactive and batch gateway pools]
      API --> DIS[Dispatcher and reconciler]
      VERIFY[Usage verifier and settler]
    end
    subgraph STORE[Private storage zone]
      PG[(PostgreSQL)]
      REDIS[(Redis hot tier)]
      OBJ[(Object storage)]
      SEC[Secret manager]
    end
    subgraph AGENT[Separate agent compute zone]
      SUP[Supervisor pool] --> BOX[Restricted runtime sandboxes]
    end
    API --> PG
    API --> REDIS
    API --> OBJ
    DIS --> PG
    DIS --> SUP
    SUP --> REDIS
    SUP --> SEC
    BOX --> OBJ
    GW --> SEC
    GW --> UP[Approved providers]
    BOX --> BROKER[Scoped model and tool access]
    BROKER --> UP
    BROKER --> TOOL[Approved external tools]
    GW --> VERIFY
    SUP --> VERIFY
    VERIFY --> PG
    CP --> OBS[Redacted observability collector]
    SUP --> OBS
```

Replica counts, cloud/region, HA policy and sandbox technology remain open decisions. All edges imply authenticated scoped access, not unrestricted network reachability. Separate workload pools protect interactive traffic from long agent jobs.

## D20 — Logical entity relationships

```mermaid
erDiagram
    APPLICATION ||--o{ EXECUTION : owns
    PROFILE_REVISION ||--o{ EXECUTION : configures
    EXECUTION ||--o{ ATTEMPT : contains
    EXECUTION ||--|| IDEMPOTENCY_RECORD : bound_by
    EXECUTION ||--o{ RESERVATION : allocates
    BUDGET_ACCOUNT ||--o{ RESERVATION_ALLOCATION : holds
    RESERVATION ||--|{ RESERVATION_ALLOCATION : scopes
    ATTEMPT ||--o{ MODEL_INVOCATION : invokes
    ATTEMPT ||--o{ OPERATION_INVOCATION : requests
    TOOL_OPERATION ||--o{ OPERATION_INVOCATION : retried_as
    MODEL_INVOCATION ||--o{ USAGE_OBSERVATION : measured_by
    USAGE_OBSERVATION }o--o{ LEDGER_ENTRY : supports
    BUDGET_ACCOUNT ||--o{ LEDGER_ENTRY : charged_by
    EXECUTION ||--o{ CONTROL_EVENT : records
    CONTROL_EVENT ||--o{ OUTBOX_DELIVERY : delivered_by
    ATTEMPT ||--o{ ARTIFACT : produces
    EXECUTION ||--o| RESULT_MANIFEST : finalizes
    RESULT_MANIFEST }o--o{ ARTIFACT : references
    APPLICATION ||--o{ RUNTIME_SESSION : scopes
    RUNTIME_SESSION ||--o{ SESSION_REVISION : checkpoints
```

Logical names clarify relationships; physical DDL/partitioning is future implementation. Usage evidence can also originate from runtime/tool summaries, so model-invocation relation is optional where source granularity is unavailable. Result-manifest relation refers official final output; candidate manifests are attempt-scoped. Session use is optional. Reservation allocation supports multiple budget scopes in one admission.

## D21 — Trust and permission boundaries

```mermaid
flowchart LR
    INPUT[Untrusted prompt, file, tool response] --> BOX[Untrusted agent execution]
    ACTOR[Authenticated app or user] --> AUTH[Server-side authorization]
    AUTH --> POLICY[Immutable profile and scoped grants]
    POLICY --> BROKER[Tool and model broker]
    BOX -->|Request only| BROKER
    BROKER -->|Approved operation| EXT[Permitted external destination]
    BROKER -->|Durable intent and receipt| CP[Trusted control services]
    BOX -->|Candidate result and telemetry| CP
    CP -->|Fenced result or verified evidence| DB[(Authoritative storage)]
    SECRETS[Control-plane secrets] --> CP
    SECRETS -.->|No direct sandbox disclosure| DENY[Denied boundary]
    BOX -.->|No host socket or arbitrary metadata access| DENY
```

Model text cannot grant permission. Evidence intake is not ledger-write authority. A signed usage report still requires verification; a successful tool call still requires app-level business acceptance where appropriate.
