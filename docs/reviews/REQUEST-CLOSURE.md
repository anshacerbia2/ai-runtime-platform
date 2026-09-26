# API contract request closure

Scope: the final agreed HTTP/client/contract implementation decisions, not a production certification or superiority claim. Baseline HEAD: ccb86c9; the implementation is in the local working tree.

| Request                                                 | Implemented evidence                                                                                                            | Acceptance evidence                                                                                                                |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| HTTP client bounds and reliable UI outcomes             | [HTTP audit](HTTP-CONTRACT-AUDIT.md); bounded transport, independent health/catalogue/mutation state                            | Transport tests and mutation-state browser tests                                                                                   |
| Atomic request token plus optimistic concurrency        | [ADR-0029](../adr/0029-replay-resources-runner-authority.md); additive receipt migration and resource mutations                 | Concurrent duplicate requests across two API instances; lost acknowledgement, rollback, real revision conflict and retained expiry |
| Resource APIs and bounded overview                      | Independent /api/v1 collections, keyset pagination and database projection; overview counts only                                | Browser never calls the legacy snapshot; independent collection failure and pagination                                             |
| Versioned runner contract and fencing                   | Separate runner binding, exact assignment/owner/generation/epoch checks, atomic revocation                                      | Stale/future token rejection, restart, duplicate proposals, concurrent grant/revoke, capacity retained by proposals                |
| Late usage must not be discarded or trusted blindly     | Separate QUARANTINED evidence intake                                                                                            | Duplicate/conflicting evidence; no direct ledger posting                                                                           |
| Explicit mappers and an enforced serialization boundary | Authored API source AST gate in npm run verify                                                                                  | Direct/alias negative fixtures; Unicode, finite JSON, accessors, timestamps and secret omission                                    |
| Retry safe operations automatically                     | Route-declared permission, frozen key/body, at most three attempts, one deadline and per-client retry budget                    | Actual post-commit dropped response in browser; deadline, abort and forbidden/conflict tests                                       |
| FE/BFF/API compatibility                                | Shared route contracts, typed consumers, current plus frozen Pact expectations                                                  | New overview/page consumer interactions and expected rejection of missing required fields                                          |
| Complete HTTP wire description                          | Provider/browser authentication boundary, correlation/retry headers, tolerant-reader export, explicit legacy migration metadata | OpenAPI boundary and additive-field schema tests                                                                                   |

## Reading this closure record

This matrix closes the agreed local HTTP/control-plane implementation scope on its recorded revision, not every planned platform capability. The current as-built reference is [CURRENT-STATE](../implementation/CURRENT-STATE.md), with the [registered operation catalogue](../implementation/HTTP-API.md). Subsequent documentation edits and source-preservation checks are recorded in [DOCUMENTATION-SYNC](DOCUMENTATION-SYNC.md); earlier test results are not relabeled as new executions.

## Deliberate boundaries

The implementation does not enable live AI provider execution, autonomous distributed dispatch, Redis runner lease recovery, sandbox supervision or token-stream SSE replay. The existing [implementation plan](../PLAN.md) and [stream recovery specification](../contracts/EVENTS-STREAMING.md) retain those P2/P3 gates. A typed runner authority message is not a live LLM stream.

Cross-language SDK conformance, persistent Broker-enforced production rollout, calibrated p95/p99/load/chaos evidence and live identity/session infrastructure remain separate gates. REST/JSON was retained deliberately; no wholesale Protobuf rewrite was agreed. Local browser/BFF deadlines must not be represented as an end-to-end provider deadline.

Current audit fixes are source changes, not just documentation. Exact final run results and local logs are recorded in [execution evidence](CONTRACT-EXECUTION.md). No commit, push, or production approval is implied.
