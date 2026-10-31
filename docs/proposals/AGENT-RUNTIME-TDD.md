# Agent Runtime: proposed technical design and test-first plan

**Date:** 22 October 2026 (Asia/Jakarta). **Status:** draft technical proposal. Stage A1 is implemented locally: the `agent-runtime` domain and ports and the AR-T01 dependency rules ([ADR-0034](../adr/0034-agent-runtime-model-inference-separation.md)). Persistence, adapters, routes and AR-T02 onward are not implemented. TDD here includes a technical design document and an ordered test-first development plan. The [system proposal](AGENT-RUNTIME-DESIGN.md) defines the authority boundaries; the [transition roadmap](AGENT-RUNTIME-TRANSITION.md) defines review and implementation gates.

## First executable slice

An authenticated application starts one Run from a pinned Definition/version. A supported trusted Harness requests model Turn 1 through Model & Inference, invokes one allow-listed read-only Tool, then requests model Turn 2 and returns a validated result. All external effects, identity and budget decisions remain mediated. The initial conformance adapters are inert fixtures with exact call counters; real provider compatibility is a subsequent explicit gate.

Inject a coordinator crash after each durable boundary, especially after an external service accepted work but before its receipt was saved. Restart must either continue from committed progress using resolved facts or remain suspended with the same ambiguous operation. It must never substitute a fresh model/Tool call for missing evidence. No arbitrary scripts, persistent SDK session dump, human approval, parallel turns, delegation or worker reassignment is implied by this slice.

## Proposed module layout

These paths are candidates, not folders implemented by this change:

```text
apps/api/src/modules/agent-runtime/
  domain/          # Definition/Run/Turn/operation invariants
  application/     # admit/read/cancel/advance/reconcile use cases and ports
  infrastructure/  # PostgreSQL, M2 and existing worker/control adapters
  presentation/    # additive authenticated HTTP commands and mappers
apps/runner/src/   # existing leased worker; trusted Harness adapters stay out of API plugins
packages/contracts/ # shared wire schemas added only when implementation is authorized
```

Agent domain/application depend only on owned domain values and port types. The M2 adapter translates stable capability requests and holds no provider SDK contract in the agent domain. Existing control-plane services remain behind explicit authority ports while admission/accounting ownership is disentangled. No new general workflow engine, broker or provider SDK dependency is selected.

## Proposed persistence and transaction boundaries

Use additive tables in a proposed `agent_runtime` schema, subject to migration review. One physical PostgreSQL instance initially is a packaging recommendation, not permission for direct cross-owner writes. Owned repositories implement the following constraints:

| Record             | Proposed key and concurrency constraints                                                                                   | Required immutable binding                                                                     |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Definition version | Unique application/Tenant + definition ID + version; immutable content once published                                      | Schema/digest, runtime release, capability/Tool/context policy and semantic approval reference |
| Run                | Unique application/Tenant + submission key; canonical request-digest conflict detection; monotonically increasing revision | Pinned definition version, initiating identity/delegation and input reference                  |
| Turn               | Unique Run + sequence; first slice has at most one unresolved Turn                                                         | Run version, input/context digest and model intent ID                                          |
| Operation          | Unique Run + logical operation ID; one digest per ID                                                                       | Kind, Turn, grant, budget allocation and durable dispatch identity                             |
| Wait               | Unique active wait per Run/revision; resume key deduplicated                                                               | Operation or human-request reference, expected revision, authority and expiry                  |
| Checkpoint         | Unique Run + committed revision; immutable scoped reference/digest                                                         | Definition/runtime format version and completed operation set                                  |
| Event/outbox       | Unique Run + revision + event ordinal                                                                                      | Transition identity and sanitized payload; consumer inbox deduplicates event ID                |

Tenant+application scoping is mandatory in lookup and uniqueness. IDs alone are not authorization. Cross-application/Tenant reads return the same unavailable response as missing resources; request bodies cannot override authenticated scope. Proposed persisted raw context requires an encrypted reference/retention contract; hashes and references are not a substitute for access policy.

Transaction recipes:

1. **Admit Run:** authenticate and validate a supported pinned version; obtain an idempotent whole-run reservation through accounting; commit Run, reservation reference and outbox. A reservation committed before a failed Run commit is an orphan held for idempotent reconciliation/release, never an authorized dispatch. A Run cannot dispatch without a confirmed matching reservation. Same-key retry recovers the same identities rather than making a second reservation.
2. **Prepare operation:** lock the Run in a bounded transaction; check expected revision, current execution authority, no cancel, remaining turn/Tool limits and pinned bindings; persist the next intent and transition/outbox. Acquire a bound accounting allocation idempotently outside the Run transaction. Persist its receipt before making the operation eligible. Allocation orphan/failure cannot authorize an external call.
3. **Cross dispatch boundary:** fresh authority/lease/policy checks and a Run-row-serialized CAS from PREPARED to DISPATCHING under the current revision; persist the attempt/dispatch identity. Only its successful caller may issue the one new external dispatch. Crash immediately after the CAS is conservatively ambiguous. A queue redelivery or same-key admission is not another successful dispatch CAS.
4. **Accept observation:** validate the response/status source and immutable binding; save operation outcome/output and checkpoint/next transition atomically under current authority. If cancelled/fenced, retain permitted late evidence separately without advancing the Run or publishing its result.
5. **Cancel/finalize:** serialize on the Run row. Cancel commits intent and blocks subsequent dispatch CAS. Finalize checks expected revision, validated durable result and resolved required operations. Whichever commits first determines the official transition; already admitted external work may still complete and be charged.

Accounting, storage and PostgreSQL writes are not assumed to share one distributed transaction. A bounded reconciler handles orphan reservations/allocations/objects using stable identities. No provider, Tool or object download runs while a database lock is held. Cancellation between allocation and dispatch rejects the dispatch and leaves allocation release to the accounting contract.

## Operation states and ambiguous outcomes

Proposed model-operation states are `PREPARED`, `DISPATCHING`, `UNKNOWN`, `SUCCEEDED`, `NO_EFFECT` and `FAILED`. These are internal proposal names. Existing ToolEffect states are preserved through an adapter; they are not renamed by this design. `FAILED` alone never means no side effect or no cost.

| Observation after restart                          | Allowed action                                                                                         | Prohibited inference                                    |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| Intent prepared, no dispatch CAS, allocation valid | Revalidate all gates and compete for dispatch CAS                                                      | A stale worker may dispatch without current authority   |
| DISPATCHING with no durable receipt                | Read status/reconcile under original identity; suspend if unresolved                                   | Generate a new operation/key or blindly repeat the call |
| Canonical inference/Tool result available          | Verify scope/digest and accept once under current revision                                             | Charge its Run aggregate again                          |
| Receiver proves NO_EFFECT                          | Retain proof; any later execution needs an explicit authorized transition and retention-valid contract | Treat generic timeout/404/HTTP failure as NO_EFFECT     |
| Remote committed, local Run cancelled/fenced       | Preserve operation/usage evidence; official progress stays closed                                      | Reopen ownership or undo the remote operation           |
| Prior native worker stop unconfirmed               | Preserve current suspension and native ownership restrictions                                          | Reassign because another node has capacity              |

Progress recovery and operation replay are separate permissions. The first slice does not automatically retry a dispatched paid call, even if a vendor offers an idempotency header. The adapter must demonstrate the relevant status/reconciliation/retention behavior. Existing lease/epoch semantics remain governed by [ADR-0031](../adr/0031-pull-dispatch-and-scoped-runner-grants.md) and [ADR-0032](../adr/0032-runner-coordination-epoch.md).

## Proposed cross-module ports

The following semantic commands are a design contract, not callable source APIs or generated HTTP operations. Transport, exact field names and route spelling remain part of the implementation review.

| Port                 | Commands and replies                                                                                        | Required behavior                                                                                                                                     |
| -------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| DefinitionRepository | Resolve exact published version for trusted caller                                                          | Immutable supported version; revoked/foreign/incompatible references deny new admission.                                                              |
| AgentRunRepository   | Admit, read, prepare operation, dispatch CAS, accept observation, cancel, finalize                          | Scoped keys/revisions and outbox; durable cancel/fence beats later mutation.                                                                          |
| ModelExecution       | Execute one authorized intent; read status/result by retained intent/inference identity; cancel best effort | Stable Capability Profile and bounded typed input, trusted lineage and allocation. No raw credential, provider SDK model or caller-selected endpoint. |
| ToolExecution        | Invoke authorized stable operation; query receiver-supported status                                         | Tool owner final auth, binding/schema/digest, deadline and retained receipt. Unknown outcomes remain unknown.                                         |
| BudgetAuthority      | Reserve Run; allocate operation; accept canonical usage; reconcile/release                                  | Idempotent scoped allocation, conservation and one ledger authority; no double hold or second posting.                                                |
| ContextStore         | Read authorized inputs; write/verify bounded checkpoint reference                                           | Content digest/version, encryption and retention; no arbitrary URL/host path.                                                                         |
| IsolatedExecution    | Acquire scoped compute; deliver permitted bytes; inspect/stop                                               | Bound assignment and immutable inputs; typed local evidence, never remote-effect or settlement authority.                                             |

An operation command carries Run/Turn/operation IDs, trusted caller/delegation context, expected authority, immutable request digest, policy reference, limits/deadline and allocation reference when chargeable. A reply distinguishes accepted identity, final observation and unresolved status. Missing ACK is not a rejected dispatch. Status commands must be non-dispatching; their absence/error cannot trigger execute as fallback.

The existing M2 gateway has durable admission/claim/result behavior, but no complete agent-intent read/allocated-budget contract is claimed here. Its adapter needs conformance before use. Direct M2 calls retain their current principal, profile, request-digest and idempotency behavior. A client-supplied allocation identifier cannot switch a public request into privileged admission.

## Proposed budget allocation protocol

Keep existing BudgetAccount/Reservation/Ledger ownership with accounting. An additive allocation record binds one root reservation, Run, operation, unit and finite ceiling. Whole-run admission first reserves a configured envelope across the required account scopes. First-slice model operations run serially. Future parallelism needs the same atomic allocation conservation proof.

1. Under the root reservation lock, allocate from its unallocated held allowance, atomically binding one operation. The allocation creates no additional account hold. Duplicate exact commands return the original allocation; a changed amount/unit/digest conflicts.
2. M2 verifies the bound allocation with accounting and commits allocated admission before calling the provider. A direct M2 admission instead creates its own existing reservation. Both modes are explicit; there is no inference from a request body or caller role alone.
3. Canonical verified usage posts once under the existing evidence identity, reduces the associated remaining hold, and updates allocation consumption. Adjustments retain source revisions. Agent summaries are read projections of those charges.
4. Unknown/in-flight exposure keeps its allowance unavailable. Unused allowance returns only after an authorized no-further-dispatch/reconciliation transition. Terminal Run status alone cannot release an unresolved allocation.
5. Actual overage posts as evidence requires and marks further allocations blocked; accounting never invents a negative hold or discards a real charge to preserve a budget claim.

Absent overage/adjustment, each root's remaining financial hold equals unallocated allowance plus the sum of unresolved allocated allowances. Account-level available funds use that root hold once. All arithmetic is checked fixed-integer in an explicit unit. Corrections/overage have explicit ledger entries and cannot silently reset history. No exchange rate, pricing source or production reserve size is chosen in this document.

This is a required new accounting capability, not an assertion that the current M2 repository already supports suballocations. Reject paid multi-turn activation until reservation/admission/crash/conservation tests pass and accounting review accepts the policy.

## Prospective API, event and error behavior

Add separate versioned operations for definition publication/resolution and Run submit/read/cancel/events. Candidate route families are `/v1/agent-definitions` and `/v1/agent-runs`; these strings are not current registered routes. Submission binds a pinned version, scoped input reference and reductions of permitted limits. It cannot choose a provider secret, authoritative Tenant, host path or expanded Tool grant.

Return a durable Run ID and revision after admission, with idempotent same-key replay/conflict behavior. Status reads expose Turn/operation progress and explicit uncertainty without leaking foreign references or secrets. Cancel is an intent receipt, not a claim that all remote compute/effects stopped. Unsupported human/delegation/session/Tool permissions deny admission before spend. Proposed rejection categories include unsupported capability, scope denial, revision conflict, budget refusal and unresolved prior operation; exact error codes await shared-contract review.

Durable events have Run revision/sequence and bounded payloads. Token deltas remain a separately bounded presentation stream; reconstructing a final result from SSE is forbidden. Resume gaps require an authorized snapshot. No retry can create another Run/Turn merely to recover a lost stream or status response.

## Context, checkpoint and retention contract

First-slice checkpoints contain pinned definition/runtime version, completed Turn/operation references, bounded permitted context and next-step state. Source facts retain provenance/access scope; rehydration rechecks access where required. A digest mismatch, revoked input, incompatible runtime or missing required bytes yields suspension/failure with a reason, not fabricated continuity. Prompt text and SDK objects are not persisted in generic execution rows or outbox.

Payload/reference cleanup is independent from usage/operation evidence retention. No production TTL is selected: O06/O12/O15 remain open. First conformance uses synthetic inert data and isolated storage/key fixtures; production must demonstrate KMS/identity/revocation and bounded deletion/retention behavior before sensitive input.

## Ordered test-first implementation plan

Each row below is a prospective suite, not a passed test or an addition to the existing G-number catalogue. Write a failing behavioral test, implement the narrow capability, then run the listed integration evidence. Use real PostgreSQL for concurrency/transaction claims; mocks alone cannot close them.

| ID     | Test before implementation                                    | Observable acceptance                                                                                                                                                   |
| ------ | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AR-T01 | Dependency boundary negative fixtures                         | Model & Inference cannot import agent modules; agent inner layers cannot import provider SDK/DB/transport; composition adapters remain permitted.                       |
| AR-T02 | Definition immutability and scoped admission                  | Pinned version stays exact; revoked/incompatible/foreign/unsupported definitions deny before reservation or external calls; duplicate key does not create another Run.  |
| AR-T03 | Same-key Run/reservation crash and concurrency                | Concurrent duplicate submissions yield one Run/root reservation; changed digest conflicts; post-reservation/pre-Run crash is reconciled without extra hold or dispatch. |
| AR-T04 | Two model turns and one read-only Tool                        | Exact ordered Run/Turn/operation/inference lineage, validated durable result, expected call counts and no provider SDK contract in Product API.                         |
| AR-T05 | Two coordinators race to advance                              | One dispatch CAS winner per intent; queue duplicates and replayed observations do not call the provider/Tool again.                                                     |
| AR-T06 | Crash before/after dispatch CAS and receipt/checkpoint commit | Prepared work may advance only through fresh gates; ambiguous dispatched work is status-only or suspended; accepted receipt is reused once after restart.               |
| AR-T07 | Receiver accepted, ACK lost                                   | Same operation identity is retained; status confirms or remains unknown; no second remote invoke; source evidence posts at most once.                                   |
| AR-T08 | Cancel versus operation/finalization commit                   | Cancel-first blocks new dispatch/result commit; admission-first may finish as late evidence; committed external effects are preserved.                                  |
| AR-T09 | Allocation concurrency, failed admission and late usage       | One account hold, bounded suballocations, no double charge; unknown exposure stays held; overage/corrections remain visible and block new spend as defined.             |
| AR-T10 | Lease/boot/epoch loss and uncertain native stop               | Old progress proposals rejected; no missing-key recreation, new paid step, automatic replacement or retained-lock takeover.                                             |
| AR-T11 | Checkpoint corruption, policy revocation and missing context  | No fabricated resume or prompt leakage; authorized suspended state and bounded cleanup/evidence retention.                                                              |
| AR-T12 | Tenant/application and delegation escalation negatives        | Same scoped not-found behavior; untrusted caller/Tool/model fields cannot extend privileges, allocation or Tool binding.                                                |
| AR-T13 | Budget/count/deadline and dependency loss                     | Turn/Tool/time/context limits stop future work; unavailable required authority/storage/accounting fails closed without zeroing unknown usage.                           |
| AR-T14 | Compatibility and independent inference                       | Existing public API/CDC/E2E passes; direct chat works when Agent Runtime is absent/disabled; historical inference rows need no fake Agent Run.                          |
| AR-T15 | Runtime adapter conformance                                   | First inert adapter proves protocol; later Claude adapter proves mediated model/Tool calls, cancellation and restart semantics without opaque bypass.                   |
| AR-T16 | Observability and output bounds                               | Correlation links are complete; oversized output/events fail within limits; no raw prompt/output/credential/grant in logs/traces/outbox.                                |

Crash cases record the exact injected boundary, retained rows/keys/holds, external call counters, fresh process identity and recovery decision. Deterministic fixture faults must be supplemented by process-kill/two-process tests for claimed crash behavior. Live provider calls require a separate explicitly authorized test profile and bounded spend.

## Slice completion and implementation entry

The initial local slice is complete only when AR-T01–14 and AR-T16 applicable fixture cases pass on the exact implementation revision, and AR-T15 passes for its inert adapter. A later real runtime/provider gate is separate. Record unsupported feature admission negatives, evidence and remaining gates without calling fixture conformance production-ready.

Before implementation, resolve the design dispositions and chartered-SAD entry process in the [transition proposal](AGENT-RUNTIME-TRANSITION.md). This document adds no migration, endpoint, package, runtime activation or test result.
