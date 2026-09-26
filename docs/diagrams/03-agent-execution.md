# D06–D08 — Agent, Scribe, dan Profile Publication

**Implementation boundary — 24 September 2026:** Agent and plugin publication flows remain target design. Immutable local profile revisions exist, but plugin approval/materialization and execution dispatch do not. See [I01–I04](10-implemented-contracts.md) and [current state](../implementation/CURRENT-STATE.md).

**Authored flow.** Referensi: [lifecycle](../contracts/EXECUTION-LIFECYCLE.md), [tools](../contracts/TOOLS-PLUGINS.md), [artifacts](../contracts/ARTIFACTS-SESSIONS.md).

## D06 — Agent happy path

```mermaid
sequenceDiagram
    participant A as Application
    participant API as Control plane
    participant DB as PostgreSQL
    participant D as Dispatcher
    participant W as Supervisor
    participant R as Redis
    participant S as Sandbox runtime
    participant T as Approved tool broker
    participant O as Object store
    A->>API: Submit profile, input, optional process and step
    API->>DB: Commit execution, hold, idempotency, outbox
    API-->>A: 202 execution reference
    D->>DB: Claim and assign attempt with generation
    D->>W: Idempotent launch assignment
    W->>R: Establish exact lease for assignment
    W->>S: Start approved runtime and harness
    loop Authorized agent steps
        W->>R: Compare-and-renew existing lease
        S->>T: Request approved model or tool operation
        T->>DB: Persist intent and verify allocation if required
        T-->>S: Result or explicit failure
        S-->>W: Progress and usage observations
    end
    S->>O: Upload candidate artifacts and manifest
    W->>API: Propose result with generation and evidence
    API->>DB: Fenced finalization and control outbox
    API-->>A: Completed with result references
    W->>API: Usage evidence independent of ownership
    API->>DB: Settlement or pending reconciliation
```

Diagram memisahkan sandbox dan supervisor. Runtime yang tidak dapat memediasi per-step model access hanya eligible bila whole-execution limits/envelope-nya terbukti; diagram bukan klaim broker tersedia pada semua runtime.

## D07 — Scribe v2 ownership flow

```mermaid
sequenceDiagram
    participant UI as Scribe UI
    participant BE as Scribe BE
    participant DB as Scribe job store
    participant AI as AI Runtime Platform
    participant PUB as Application publish destination
    UI->>BE: Start document job
    BE->>DB: Create business job and step
    BE->>AI: Prompt or input refs, process ID, profile
    AI-->>BE: Execution ID and progress
    BE-->>UI: Business progress
    AI-->>BE: Draft artifacts and execution outcome
    BE->>BE: Domain validation and review decision
    alt Accepted by application
        BE->>PUB: Idempotent authorized publication
        BE->>DB: Record publication outcome
    else Needs repair or rejected
        BE->>DB: Record business outcome
        BE->>AI: Optional new repair execution
    end
    BE-->>UI: Final business result
```

AI execution COMPLETED tidak berarti dokumen diterima atau sudah dipublikasikan. Repair adalah keputusan Scribe; platform tidak menyimpan state bisnis dokumen.

## D08 — Profile dan package publication

```mermaid
flowchart LR
    APP[App owner versions harness and schemas] --> DRAFT[Draft profile]
    DRAFT --> COMP[Validate runtime and provider compatibility]
    COMP --> SEC[Review permissions and data policy]
    SEC --> TEST[Contract and quality acceptance]
    TEST --> PASS{All applicable gates pass?}
    PASS -->|No| REVISE[Revise candidate]
    REVISE --> DRAFT
    PASS -->|Yes| PIN[Publish immutable revision and digests]
    PIN --> ALIAS[Canary profile alias]
    ALIAS --> MON[Observe and app approval]
    MON --> ACT[Activate broader rollout]
    MON --> ROLL[Rollback alias for new executions]
```

Existing execution tetap memakai snapshot pinned. Security revoke dapat menghentikan version melalui audited control, bukan mengubah snapshot historis.
