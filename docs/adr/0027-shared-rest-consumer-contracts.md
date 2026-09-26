# ADR-0027 — Shared REST Contracts, Inferred Clients, and Consumer Verification

**Status:** implemented in source; persistent Broker/deployment wiring requires environment configuration.

## Implementation reconciliation — 24 September 2026

Shared contracts now compose M0/M1, resource and runner authority, plus the active M2 gateway/SSE surface. Current Pact coverage is eleven interactions per boundary; frozen baselines keep the original nine. It is not exhaustive CDC for every operation. See [current source state](../implementation/CURRENT-STATE.md), [active HTTP operations](../implementation/HTTP-API.md), and [verification scope](../reviews/CONTRACT-EXECUTION.md). This note updates implementation status only; it does not create new reviewer approval or erase the original decision history.

## Decision

The implemented M0–M2 HTTP surface has one source of truth in `packages/contracts/src/http`: method, path, parameters, query, request headers/body, success responses, streaming metadata, and normalized error responses. Zod supplies runtime validation and inferred TypeScript input/output types. Clients use direct inference, not periodically regenerated DTOs.

The framework adapter uses `@ts-rest/core` with pinned version `3.53.0-rc.1`. This release supports the existing Zod 4 schemas. The stable 3.52 adapter line requires Zod 3, and the published Nest adapter peers do not include this repository's Nest 12. We retain a small, tested Nest HTTP decorator/interceptor binding instead of forcing incompatible peers, downgrading schemas, or replacing the domain framework. The release-candidate dependency is an explicit upgrade risk; reevaluate it when compatible stable releases are available.

## Boundaries

`ContractRoute` binds Nest routing and request/response validation to the shared endpoint. Handler response annotations and repository port types are inferred from those schemas. Runtime validation checks explicit wire DTOs before serialization, and the BFF/client check received JSON. The old stringify/parse normalization is removed; type assertions alone are not validation. Domain authorization, transactions, and provider execution remain owned by the API.

The browser uses operation clients such as `api.lab.health()`. No feature chooses an arbitrary URL/response-type pair. `labClient` composes catalogue reads without defining another wire DTO. Health, catalogue, and editor/mutation states are separate; a failed request is not proof that a database or API is offline.

The BFF consumes an explicit subset of the same endpoints. Machine-only runner/inbox routes are not exposed automatically. Session custody stays on the server. Validated, allowlisted response fields cross the boundary; validation diagnostics and provider secrets do not.

## Consumer-driven contracts

Pact consumer tests exercise the actual console client and the actual BFF forwarder against mock providers. Expectations are consumer-authored, not generated from server schemas. Provider verification replays the resulting interactions against Nest/Fastify with PostgreSQL and against an HTTP adapter invoking the production BFF forwarding code. Next route/session behavior is additionally checked by BFF and browser tests.

The initial consumer coverage is nine interactions on each hop: health, profile/example/schema catalogues, history list/record, create/replay validation, and the operator snapshot. Other implemented M1 operations remain under shared runtime/compile-time contracts and integration tests; they are not falsely described as already having a consumer Pact when no current console consumer uses them.

Versioned consumer expectations are retained in `tests/cdc/baselines/v1`. Normal verification checks both current generated Pacts and the frozen baseline. A negative test deliberately removes `saved_checks` from an otherwise real provider response and must fail Pact verification. Type tests separately demonstrate that renamed fields, missing headers, unknown operations, and machine-only browser operations fail compilation.

## Deployment compatibility

Pact publication and provider-result publication are versioned by exact Git SHA. Provider selection includes current-branch consumers, deployed/released consumers, and retained baselines. `can-i-deploy` must pass for the exact candidate and destination environment; missing, unknown, or incompatible results block delivery. Recording deployment happens only after actual successful rollout.

CI provisions an isolated Broker and database to demonstrate successful and rejected deployment matrices against a simulated older consumer. The reusable deployment-gate workflow requires a persistent Broker URL/token and is intended to be a required dependency of the real rollout job. This repository does not invent a production deployment target or claim that an external rollout workflow is protected before it actually invokes the gate.

## Rejected alternatives

Manual FE DTOs and URL strings; backend-only documentation; calling schema tests CDC; selecting only newly updated consumers while ignoring deployed versions; disabling peer checks; and silently succeeding when Broker credentials or verification evidence are absent.

## Verification and operations

See [Contract Operations](../development/CONTRACTS.md), [Frontend Architecture](../architecture/FRONTEND.md), and [Validation](../reviews/VALIDATION.md). OpenAPI files are generated documentation artifacts; changing them directly does not change the inferred clients.
