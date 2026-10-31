# ADR-0034 — Separate Model & Inference and Agent Runtime authorities in one monorepo

**Date:** 1 November 2026
**Status:** accepted by the repository owner; stage A1 (compatible boundaries) implemented locally. Amends the one-product framing in [Architecture §13](../architecture/ARCHITECTURE.md#13-control-plane-connections-plugins-dan-distributed-fleet). Does not change SAD-011 or SAD-020 in the Scnehaux architecture repository.
**Basis:** Scnehaux ADR-GLB-015 (accepted), [alignment review](../reviews/SCNEHAUX-ARCHITECTURE-ALIGNMENT.md), [system design](../proposals/AGENT-RUNTIME-DESIGN.md), [technical design](../proposals/AGENT-RUNTIME-TDD.md), [transition roadmap](../proposals/AGENT-RUNTIME-TRANSITION.md), [ADR-0001](0001-application-ownership.md), [ADR-0007](0007-durable-accounting.md), [ADR-0010](0010-tool-side-effects.md), [ADR-0012](0012-deployment-dispatch.md), [ADR-0018](0018-clean-architecture-quality.md).

## Context

This repository described one AI Runtime Platform in which a single Execution Plane runs both the model gateway and the agent runtime. Scnehaux ADR-GLB-015 separates Model & Inference authority from Agent Runtime authority, and the approved PAD-PLT-008 and PAD-PLT-016 describe them as two Platform Products. The alignment review paused the trusted runtime bridge until the local design was reconciled with that split. The proposal package recommends AR-P01 to AR-P08 and makes their disposition the exit of stage A0.

## Decision

The repository owner accepts AR-P01 to AR-P08 as proposed, for this repository:

| ID     | Accepted position                                                                                                          |
| ------ | -------------------------------------------------------------------------------------------------------------------------- |
| AR-P01 | Model & Inference (the M2 gateway) and Agent Runtime are separate modules in this monorepo, with enforced import rules.    |
| AR-P02 | Agent Definition, Run and Turn are new durable records, distinct from Execution and Attempt and linked to them explicitly. |
| AR-P03 | PostgreSQL state transitions plus a transactional outbox; no new workflow engine or broker. Redis keeps its current role.  |
| AR-P04 | Agent Runtime calls models only through its model-execution port, backed first by M2. No provider SDK in the agent module. |
| AR-P05 | One whole-run reservation with bound internal allocations per operation, under the existing single ledger authority.       |
| AR-P06 | Resume only from committed progress; reconcile every ambiguous dispatched operation by status, never by a new dispatch.    |
| AR-P07 | Isolated execution (sandbox) is an optional adapter; definitions needing it are refused until its gates pass.              |
| AR-P08 | The first slice runs serial turns and one allow-listed read-only Tool; unsupported requirements fail admission.            |

Disposition record: decided by Ansha Cerbia as repository owner on 1 November 2026, accepting the proposal text at commit `93dbeae` without amendment. Rationale: it adopts the accepted product split while keeping the merged M0 to M3 implementation and evidence, and it adds no repository, deployment or broker split ahead of measured need.

What this decision does not do:

- It does not move SAD-011 or SAD-020 out of chartered status. Those documents live in the Scnehaux architecture repository, outside this repository's write scope. The governance path is to submit the proposal package there as downstream input through that repository's own workflow. Until that happens, this repository claims no Scnehaux physical-design conformance.
- It does not dispose of the separate reviews the transition roadmap lists for accounting (O07, O13), identity and delegation (O05, O14, O16), data retention (O06, O12, O15), Tool and pilot eligibility (O08, O09) and isolated execution (O02, O03). The stage entries that depend on them stay closed until they are decided.
- It does not activate any migration or durable runtime. `agent_execute` stays CONTRACT_ONLY. The request-scoped preview route added later is described under stage A2-preview below.

### Stage A1 implementation

`apps/api/src/modules/agent-runtime/` holds the agent's owned domain values and its ports. It contains no adapter, table, route or Nest module, and the composition root does not register it.

- **Domain:** operation states (`PREPARED`, `DISPATCHING`, `UNKNOWN`, `SUCCEEDED`, `NO_EFFECT`, `FAILED`) with legal transitions and a restart rule that allows only a status read after the dispatch boundary. Also the Run lifecycle with terminal states and the rule that cancel intent closes admission. Neither extends the public `ExecutionStatus` or `ToolEffect` states.
- **Ports:** `ModelExecution`, `BudgetAuthority`, `ToolExecution` and the optional `IsolatedExecution`. They carry trusted caller scope, operation identity, request digest and allocation references, and never a provider, credential or endpoint.
- **Dependency rules** (`scripts/lib/dependency-rules.mjs`, run by `npm run architecture:check`):
  - Nothing outside the agent module except the API composition root may import it, even for types. This includes Model & Inference, the control plane and the runner.
  - The agent module may not import a provider SDK or a gateway provider adapter.
  - The agent module's domain and application layers may depend only on their own code, identity domain types and shared domain values.
  - An infrastructure adapter may later wrap the M2 application boundary.

### Stage A2-preview: request-scoped agent runs (1 November 2026)

The repository owner asked for a visible agent capability before the durable stages. The preview adds one route, `POST /v1/agent/runs` (`agent.run`; browser `/api/v1/agent/runs`), and the Playground's Agent mode. It does not change the decisions above, and the closed stages stay closed.

- **What a run is:** a loop of model turn, at most one tool call, and observation, within a step limit (at most 8) and a run token cap. It lives for one request and streams typed `AgentRunEvent` frames over SSE. Closing the stream cancels the run. Nothing about the run is persisted, and a run cannot be resumed or replayed.
- **Model calls:** `GatewayModelExecution` wraps the M2 `GatewayService` application boundary, the only thing `GatewayModule` now exports. Every model turn is a separately admitted, budget-checked and accounted gateway execution under the caller's own principal, keyed by `<runId>:model:<step>`. Tool use is a provider-neutral JSON reply protocol over the `chat` capability, so the gateway and provider adapters are unchanged.
- **Tools:** three read-only built-ins, all running with the caller's own authority: `current_time`, `calculate` (a bounded parser with no eval) and `execution_lookup`, which reads one of the caller's executions through the gateway's `execution:read` check. The application principal has no `platform:read`, so the agent cannot read operator resources.
- **Budget:** `InProcessRunBudget` only checks that each step fits the run envelope; it holds no account units. Unknown output is charged against the run cap at the step ceiling, never as zero. The durable whole-run reservation in Accounting is still stage A2 and still needs the accounting review (O07, O13).
- **Unchanged:** `agent_execute` on `/v1/executions` stays CONTRACT_ONLY. No table, migration or provider adapter was added. Identity stays application-scoped with `tenantId` null.
- **Evidence:** `apps/api/test/unit/agent-run.test.ts` covers the loop, step limit, token cap, cancel, unknown tools, refusal codes, reply parsing and the calculator. `apps/api/test/agent-run.integration.test.ts` runs the agent on real PostgreSQL with a scripted provider: two completed gateway executions, 100 tokens posted, 0 held. `apps/web/test/playground-agent.test.ts` and `tests/e2e/ai-playground.spec.ts` cover the browser side. No live provider call has been made from this repository.

## Alternatives considered

- **Continue as an independent prototype under the local ADRs.** Rejected: it would leave the accepted product split unaddressed and the bridge paused indefinitely.
- **Extract a separate repository or service now.** Rejected: it adds network and migration failure modes before the module authority is proven.
- **Relabel Execution and Attempt as Run and Turn.** Rejected: worker ownership is not agent progress, and historical rows would acquire meanings they never had.

## Consequences

The Model & Inference side cannot grow a dependency on agent code, so direct inference keeps working whether or not Agent Runtime exists. Later stages fill the ports with adapters and tables:

- **A2:** durable identity and whole-run accounting. It needs the accounting review before any paid multi-turn execution.
- **A3:** the first durable flow, using inert adapters.

The trusted runtime bridge from M3 resumes as A4 behind these ports. Direct writes by one module into another's tables are not yet checked statically; repository ownership review covers that until a schema-level rule exists.

## Verification

- **AR-T01:** negative and positive fixtures in `scripts/test/dependency-rules.test.mjs`, plus `npm run architecture:check` on the real tree. A probe file importing the agent module from the gateway is rejected.
- **Domain rules:** `apps/api/test/unit/agent-runtime-domain.test.ts`.
- **AR-T14:** existing unit, integration, web, CDC, `contracts:check` and build suites pass with the agent module unregistered. Generated contracts and Prisma schema are unchanged, so no historical row needs an Agent Run.

## Revisit trigger

Revisit when the Scnehaux SAD-011 or SAD-020 reaches draft with a physical design that differs from this one, when one of the listed separate reviews rejects a position here, or when measured scaling or security needs justify a separate deployment.

## Affected documents

[Architecture §13](../architecture/ARCHITECTURE.md#13-control-plane-connections-plugins-dan-distributed-fleet), [Code structure](../architecture/CODE-STRUCTURE.md), [transition roadmap](../proposals/AGENT-RUNTIME-TRANSITION.md), [system design](../proposals/AGENT-RUNTIME-DESIGN.md), [technical design](../proposals/AGENT-RUNTIME-TDD.md), [alignment review](../reviews/SCNEHAUX-ARCHITECTURE-ALIGNMENT.md), [ADR index](README.md), [docs index](../INDEX.md).
