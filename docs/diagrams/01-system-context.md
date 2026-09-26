# D01–D03 — Context, Containers, dan Components

**Implementation boundary — 24 September 2026:** Target container/components below include gateway and workers not present in the running source. The actual Next.js/BFF, API and PostgreSQL boundaries are shown in I01. See [I01–I04](10-implemented-contracts.md) and [current state](../implementation/CURRENT-STATE.md).

**Authored baseline 0.2 views.** Diagram bukan deployment existing. Boundary otoritatif: [BOUNDARIES](../architecture/BOUNDARIES.md); overview: [ARCHITECTURE](../architecture/ARCHITECTURE.md).

## D01 — System context

```mermaid
flowchart LR
    USER[End user] --> APP[Application UI and backend]
    APP -->|AI input and optional process context| PLATFORM[AI Runtime Platform]
    PLATFORM -->|Result events and usage| APP
    PLATFORM --> MODEL[Approved model providers]
    PLATFORM --> TOOL[Approved external tools]
    IDP[Existing identity authority] -->|Validated identity binding| PLATFORM
    OPS[Platform operations] -->|Approved policy and recovery| PLATFORM
    APP --> DOMAIN[Application business data and workflow]
```

Domain data/workflow tetap di app. Platform tidak memanggil database aplikasi tanpa tool contract/authorization yang disetujui. Identity integration adalah boundary target, bukan klaim existing IdP telah tersambung.

## D02 — Logical container view

```mermaid
flowchart TB
    APPS[Application backends and chat BFF] --> API[API and stream endpoint]
    subgraph CONTROL[Trusted control plane]
      API --> POL[Policy and profile registry]
      API --> ADM[Admission and accounting]
      API --> ROUTE[Capability router]
      ROUTE --> GW[Direct model gateway]
      ROUTE --> DIS[Durable dispatcher]
      REC[Reconciler and supervisor service] --> DIS
      VER[Usage verifier and settler] --> ADM
    end
    subgraph COMPUTE[Isolated agent compute]
      DIS --> SUP[Worker supervisor]
      SUP --> BOX[Sandbox with runtime and approved harness]
    end
    PG[(PostgreSQL SoR)] --- ADM
    PG --- DIS
    PG --- REC
    PG --- API
    REDIS[(Redis hot tier)] --- API
    REDIS --- SUP
    OBJ[(Object storage)] --- BOX
    OBJ --- API
    SECRET[Secret and grant broker] --> GW
    SECRET --> SUP
    GW --> PROVIDERS[OpenRouter and direct provider]
    BOX --> BROKER[Scoped model and tool access]
    BROKER --> PROVIDERS
    BROKER --> EXT[Authorized external services]
    GW --> VER
    SUP --> VER
```

Arrows menggambarkan interaksi logis, bukan akses tanpa auth. Redis bukan source financial reservation; worker tidak menulis PG langsung. Runtime native provider access hanya melalui scoped binding yang enforcement-nya dibuktikan.

## D03 — Control-plane component flow

```mermaid
flowchart LR
    REQUEST[Request] --> AUTH[Authenticate and authorize]
    AUTH --> VAL[Validate input and profile snapshot]
    VAL --> IDEM[Idempotency resolution]
    IDEM -->|New request| HOLD[Atomic admission and hold]
    IDEM -->|Replay| SNAP[Return prior execution]
    HOLD --> ROUTE[Route compatible capability]
    ROUTE --> DIRECT[Direct executor]
    ROUTE --> QUEUE[Agent dispatch intent]
    DIRECT --> FINAL[Authoritative finalization]
    QUEUE --> WORK[Managed worker execution]
    WORK --> FINAL
    FINAL --> SNAP
    DIRECT --> EVID[Usage evidence intake]
    WORK --> EVID
    EVID --> SETTLE[Independent settlement]
```

Finalization dan settlement adalah jalur berbeda. App menerima result tanpa harus menunggu seluruh provider billing lengkap. INV-01/02/08/09.
