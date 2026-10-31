# Scnehaux architecture alignment review

**Snapshot:** 21 October 2026 (Asia/Jakarta). **Status:** review and proposal for discussion; not an architecture decision, approval, or replacement roadmap.

## Finding

PR #22 is merged at `b836f58fe6a799f26e29bae831b136f7b9007d3b`. Its [native coordinator evidence](../development/NATIVE-COORDINATOR-CONFORMANCE.md) remains useful: real API/PostgreSQL/Redis coordination, one native sandbox launch, cancellation, lease-loss fencing, and conservative local ownership release. It does not establish a complete Agent Runtime or approve a production sandbox.

Before extending the trusted runtime bridge, a comparison with the current sibling architecture checkout found a material boundary difference. This repository describes one platform owning both bounded model execution and agent execution. The current Scnehaux documents describe two Platform Products and explicitly withhold physical-design approval. Continuing implementation under the assumption that these descriptions already agree would conceal an unresolved design question.

This finding does **not** imply that existing code must be discarded, that two repositories or deployments are required, or that this review can overrule approved decisions.

## Source authority and reproducibility

The comparison read the sibling `scnehaux-architecture` checkout at commit `52a7d1d18f9235c64d6e8a89bee17d3dade728e9`. The four sources below had no working-tree changes. Their status is taken from their own metadata and text, not inferred from a principal review.

| Source in `scnehaux-architecture`                                                            | Recorded status          | Relevant statement                                                                                                                                                                                  |
| -------------------------------------------------------------------------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `05-decisions/_global/ADR-GLB-015-separate-model-inference-and-agent-runtime.md`             | accepted                 | Sections 5.1–5.2 separate Model & Inference authority from Agent Runtime authority. Section 5.10 separately qualifies isolated execution.                                                           |
| `03-domain/PAD-PLT-008-model-inference-platform/PAD-PLT-008-model-inference-platform.pad.md` | approved, version 3.0.0  | Bounded model execution, Capability Profiles, provider routing, usage/quota/cost and provider health; excludes durable Agent Run/Memory/Tool Binding authority.                                     |
| `03-domain/PAD-PLT-016-agent-runtime-platform/PAD-PLT-016-agent-runtime-platform.pad.md`     | approved, version 1.0.0  | Agent Definition/Run/Turn, Harness, context/memory, Tool mediation, budgets, waits/resume and delegation; consumes Model & Inference.                                                               |
| `04-system/scnehaux-agent-runtime-platform/scnehaux-agent-runtime-platform.sad.md`           | chartered, version 0.1.0 | PAD approval does not approve physical design. The status notice rejects implementation against the placeholder until it moves to draft. No framework/database/broker/sandbox topology is selected. |

SAD-011 (`04-system/scnehaux-model-inference-platform/scnehaux-model-inference-platform.sad.md`) has the same chartered physical-design restriction. The local Git history associates ADR-GLB-015 and SAD-020 with commit `58142e1`, titled “Close the approved-at-0.x contradiction, and make the gates that should have caught it actually run”. This review does not establish when a prior conversation reviewed those files or whether an approved downstream exception exists elsewhere.

Local [ADRs](../adr/README.md), [architecture](../architecture/ARCHITECTURE.md), [plan](../PLAN.md) and [roadmap](../ROADMAP.md) remain unchanged. No local source found in this comparison explicitly reconciles them with ADR-GLB-015 or records an exception to the chartered SAD restriction. That is a traceability gap, not proof that no such decision exists anywhere.

## Implementation mapping

This is a reuse assessment, not a completed extraction or a claim of architectural conformance.

| Existing implementation                                                                     | Potential target responsibility                   | Evidence and remaining work                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M2 gateway, OpenRouter/Anthropic adapters, SSE/replay, fallback, circuit and usage handling | Model & Inference                                 | [Gateway module](../../apps/api/src/modules/gateway/gateway.module.ts) exists. It imports the shared ControlPlaneModule and consumes M1 admission/accounting through [ControlPlaneGatewayAdapter](../../apps/api/src/modules/gateway/infrastructure/control-plane-gateway.adapter.ts); independent product authority is not yet demonstrated. |
| Generic execution/attempt/profile records, admission and reservations                       | Requires explicit ownership mapping               | [Physical schema](../../prisma/schema.prisma) models Execution/Attempt/ProfileRevision/RunnerAssignment/ToolEffect. These names cannot simply be relabelled Agent Run/Turn/Definition without specifying semantics, lineage and migration compatibility.                                                                                      |
| Pull dispatch, boot-bound grants, lease/epoch fencing and worker lifecycle                  | Reusable execution infrastructure candidate       | [RunnerWorker](../../apps/runner/src/runner-worker.ts) coordinates one assignment and calls a trusted runtime callback after STARTED. This is not a durable Agent turn/context/memory/wait/delegation engine.                                                                                                                                 |
| Pinned bundles, runsc process transport, cgroup inspection and exclusive host lifecycle     | Isolated execution adapter candidate              | [NativeRunscHost](../../apps/runner/src/native-runsc-host.ts) is opt-in and experimental. ADR-GLB-015 section 5.10 does not make sandbox authority an automatic responsibility of Agent Runtime. O03 remains open.                                                                                                                            |
| Scoped payload/plugin delivery and one-use borrowed buffers                                 | Reusable scoped delivery candidate                | [M3 handoff contract](../development/M3.md#payloadplugin-handoff-ke-trusted-runtime) and worker code constrain downloads and erase borrowed buffers. Actual guest handoff and production KMS/trust wiring remain incomplete.                                                                                                                  |
| Tool-effect intent/status/reconciliation and quarantine evidence                            | Agent-side mediation with external Tool authority | Existing [Tool contract](../contracts/TOOLS-PLUGINS.md) already preserves receiver idempotency/status and unknown outcomes. Final authorization and operation truth must remain with the Tool owner.                                                                                                                                          |

There are useful existing invariants to preserve: applications own business outcomes; simple inference can bypass agents; stale workers cannot publish official results; cancellation does not undo committed external effects; and unknown cost/effect evidence is not converted into zero cost or a retry grant.

## Proposed next step for discussion

Recommendation: establish the downstream design and its relationship to the accepted split before adding the native payload/plugin bridge as the next product feature. Preserve the merged implementation and its evidence throughout. Do not infer a repository, database, deployment, or framework split from a product-authority split alone.

The reviewable design package would contain:

1. A responsibility/data/contract map for Model & Inference, Agent Runtime, Tool owners and optional isolated execution, including shared infrastructure and explicit authority boundaries.
2. A SAD-020 draft proposal covering Definition/Run/Turn identity, context and memory ownership, Tool lineage, budget/stop reasons, wait/resume/delegation, recovery and cancellation. It must reference the existing M2 and worker components without treating them as a complete agent engine.
3. A proposed downstream technical design and migration sequence: Agent Runtime consumes a model-execution port; an optional isolated-execution port owns sandbox integration; current public operations, result authority and accounting retain explicit compatibility rules. Exact interfaces and physical placement remain design choices for discussion.
4. A test-first plan with observable acceptance criteria: direct inference without Agent Runtime; durable run recovery without replaying unknown effects; bounded Tool/delegation authority; cancelled/fenced runs cannot initiate new work; model usage and agent/run lineage remain attributable without double settlement.

The sibling architecture repository is outside this workspace's write scope. No SAD status or architecture source there has been edited. A draft proposal in this repository would not itself move SAD-020 to draft or grant architecture approval.

An alternative is to explicitly continue this repository as an independent experimental prototype under its local ADRs. That would preserve the current implementation direction while leaving Scnehaux conformance unclaimed. The owner needs to choose that scope explicitly; this review does not choose it on their behalf.

## Checks and limits

### Follow-up proposal — 22 October 2026

The owner authorized preparation of a concrete alignment package. The [system design](../proposals/AGENT-RUNTIME-DESIGN.md), [technical design/test-first plan](../proposals/AGENT-RUNTIME-TDD.md), and [transition roadmap](../proposals/AGENT-RUNTIME-TRANSITION.md) now provide proposed authority/data boundaries, budget allocation and recovery semantics, compatible reuse and prospective acceptance tests. This is authorization to prepare a reviewable design, not disposition of its individual choices or a change to the external SAD status. The separate-prototype alternative above remains historical discussion context; the prepared package follows the recommended alignment direction.

### Disposition — 1 November 2026

The repository owner accepted AR-P01 to AR-P08 and chose the alignment direction over the separate-prototype alternative. [ADR-0034](../adr/0034-agent-runtime-model-inference-separation.md) records the decision, amends Architecture §13 and describes stage A1. The traceability gap noted above is closed for the local ADRs. SAD-011 and SAD-020 remain chartered in the Scnehaux repository, and this repository still claims no conformance with them.

### Original checks

Checked the merge/main commit, local worktree, source status/history in the sibling checkout, registered API composition, gateway/control-plane coupling, schema model inventory and the worker/native-host handoff. No runtime source, schema, production configuration, local ADR, plan or roadmap was changed. No provider call or native runtime was launched, and no fresh runtime-test result is claimed for this documentation review. The user-owned `docs/temp.md` was not read or modified.
