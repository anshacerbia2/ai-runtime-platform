# D22–D23 — Implementation Dependencies dan Migration

**Implementation boundary — 24 September 2026:** Dependency arrows express delivery requirements, not that every preceding production gate has already passed. P1 local tests and manual runner authority do not close P3/P3.5. See [I01–I04](10-implemented-contracts.md) and [current state](../implementation/CURRENT-STATE.md).

**Authored plan visualization.** M0 is runnable and M1 durable foundation plus receipt/resource/runner-authority extensions are implemented locally. Full gateway/agent execution milestones remain PLANNED and P3.5 production approval is BLOCKED. Canonical source: [PLAN](../PLAN.md), [ROADMAP](../ROADMAP.md).

## D22 — Dependency and readiness flow

```mermaid
flowchart LR
    P0[P0 Contracts and open decision closure] --> P1[P1 Durable identity, state and accounting]
    P1 --> P2[P2 OpenRouter and direct adapter proof]
    P1 --> P3[P3 Claude runtime and sandbox]
    P2 --> G[P3.5 Applicable reliability and security gates]
    P3 --> G
    G -->|Evidence accepted| P4[P4 Controlled app migration]
    G -->|Evidence accepted| P5[P5 Codex runtime conformance]
    G -->|Evidence accepted| P6[P6 Gemini runtime conformance]
    P5 --> RG[Repeat affected gates and quality tests]
    P6 --> RG
    RG --> P4
    P4 --> P7[P7 Evidence-driven expansion]
    G -->|Failure or missing evidence| FIX[Fix implementation or decision gap]
    FIX --> G
```

P2/P3 may overlap once common contracts are stable. Nonproduction trials precede production gates; production cutover does not. Multi-runtime support is not required before first shared-platform value.

## D23 — Per-application migration and rollback

```mermaid
flowchart TD
    INV[Inventory invocation seams, data and side effects] --> BASE[Capture quality and cost baseline]
    BASE --> PROFILE[Register identity, profile and scoped credentials]
    PROFILE --> NONPROD[Nonproduction adapter and business tests]
    NONPROD --> GATE{Applicable platform and app gates pass?}
    GATE -->|No| FIX[Fix or narrow scope]
    FIX --> NONPROD
    GATE -->|Yes| CANARY[Limited production canary]
    CANARY --> OBS[Observe quality, latency, usage and uncertainty]
    OBS --> ACCEPT{App owner acceptance?}
    ACCEPT -->|Yes| ROLL[Expand traffic with rollback retained]
    ACCEPT -->|No| BACK[Route new submissions back to old path]
    BACK --> RECON[Reconcile in-flight executions and holds]
    ROLL --> END[Retire old integration only after closure]
```

No duplicate stateful shadow execution. Rollback preserves idempotency and operation identity; it does not rerun ambiguous remote mutations. Job/domain state remains in the app throughout migration.
