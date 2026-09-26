# ADR-0028 — Bounded HTTP behavior and explicit mutation outcomes

Date: 24 September 2026. Status: local implementation verified; production acceptance and reviewer approval remain open. Extends [ADR-0027](0027-shared-rest-consumer-contracts.md), not a replacement for the planned runtime or [stream contract](../contracts/EVENTS-STREAMING.md).

> Retry policy and resource/runner extensions are superseded by [ADR-0029](0029-replay-resources-runner-authority.md). The original one-attempt record below describes the earlier hardening revision.

## Implementation reconciliation — 24 September 2026

This is the historical one-attempt hardening decision. ADR-0029 supersedes retry/resource/runner scope and the final OpenAPI export now models tolerant reader input schemas. Original evidence and rationale below are retained. See [current source state](../implementation/CURRENT-STATE.md), [active HTTP operations](../implementation/HTTP-API.md), and [verification scope](../reviews/CONTRACT-EXECUTION.md). This note updates implementation status only; it does not create new reviewer approval or erase the original decision history.

## Context

Data-shape inference and Pact compatibility alone do not bound a slow response, distinguish a lost write acknowledgement, or prevent an old UI operation overwriting a newer editor state. The audit reproduced rejection of additive nested profile fields, found redundant provider JSON roundtripping, and found independently swallowed health-refresh failures.

## Decision

Keep REST/JSON for the implemented M0/M1 control-plane and lab surface. The shared HTTP package publishes behavior as well as shapes: unary JSON, a 30-second caller safety ceiling, an 8-MiB decoded response-byte ceiling, a 64-KiB browser error-diagnostic ceiling, and one transport attempt. These are local client/BFF safety policies, not measured production SLOs or a claim that the API enforces the same deadline. BFF configuration can lower its limits; injected browser limits can only lower the shared ceilings.

Response readers validate known fields and strip unknown object properties, including nested profile, limits, report, and issue views. Strict command/domain schemas remain strict. Do not change all schemas to passthrough: unknown authority fields and secret material must not be promoted through the BFF. Enum additions, changed meanings, removed fields, and changed requiredness still require compatibility review.

Provider handlers return explicit wire DTOs: timestamps are ISO strings, monetary/integer precision-sensitive values use the existing decimal-string representation. The response interceptor validates/projects those DTOs directly, without stringify/parse normalization. The BFF still validates and reprojects at its trust boundary. Removing that boundary or replacing it with a serializer requires equivalent negative security/contract tests, not merely a speed comparison.

The browser and BFF wait for fetch/body/session work under cancellable local deadline scopes. Actual response bytes are bounded even when Content-Length is absent or wrong. Invalid UTF-8 and unexpected media types are rejected; unused bodies are cancelled without waiting forever for cancellation. A successful HTTP status is not sufficient to establish a valid response. A connection abort is not server rollback.

Mutation state is an exclusive union: idle, pending, success, error, unknown. Each completion is bound to the originating operation generation. Editor/key/scenario changes invalidate the old generation. A confirmed durable response completes the write immediately; secondary health refresh has a separate state and warning. Health, catalogue, validation outcome, and durable save outcome must not overwrite one another. A saved validation with valid=false is a successful save of a rejected domain contract, not a transport failure.

No automatic retry is enabled. Retry-After is a bounded hint, not replay authorization. A lost response after dispatch yields unknown outcome: reconcile via history/snapshot or replay the same application-scoped key and canonical payload. Existing server SHA-256 fingerprint comparison and conflict409 remain authoritative. Idempotent admission is not exactly-once execution or a guarantee of zero duplicate upstream cost after an ambiguous provider call.

OpenAPI exports x-runtime-behavior from the same policy. This custom extension is documentation/machine metadata; generic generated SDKs do not enforce it automatically. Output JSON Schema describes the producer's projected payload and may set additionalProperties=false. External consumer generators must separately honor the documented tolerant-reader policy. No multi-language SDK conformance is claimed.

## Alternatives and consequences

A blanket Protobuf/gRPC migration would not itself fix the browser race, unknown write outcome, retry ownership, or stream replay semantics. Retaining REST preserves the existing browser/BFF deployment while making its limits explicit. A compiled serializer remains an optimization candidate only after request/response parity, secret omission, and representative performance evidence; JSON-vs-binary is not a maturity certificate.

One-attempt transport deliberately favors safety over transparent retry availability. Stopping client wait does not forcibly stop a non-cooperative dependency or committed transaction. Resource cleanup and durable reconciliation remain separate obligations. Operational limit tuning requires a versioned policy change and workload evidence.

## Historical follow-up matrix at ADR-0028 adoption

| Workstream          | Required proof                                                                                                                                                                                                     | Boundary at the historical checkpoint                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| End-to-end deadline | Authenticated/clamped remaining budget; monotonic decrement at every hop; API and adapter stop before new expensive work; transaction/outbox reconciliation survives cancellation                                  | Local browser/BFF waits bounded; no backend budget propagation                            |
| Streaming           | Real provider through ingress/BFF; incremental framing, split UTF-8, bounded frames/queues, slow-subscriber isolation, heartbeat, cursor410/reset, disconnect-detach, no POST replay or duplicate model invocation | Existing design in EVENTS-STREAMING; no runtime SSE endpoint implemented                  |
| Retry ownership     | One layer owns retry, per-operation replay policy, bounded attempts/time, jitter, total retry budget, Retry-After, breaker/rate-limit interaction, no ambiguous unkeyed replay                                     | One attempt; no retry scheduler or circuit breaker                                        |
| Compatibility       | New provider with frozen consumer; nested additions; missing/changed fields denied; independent release matrix including generated SDK consumer fixtures                                                           | Existing Pact plus local reader regressions; no persistent production gate result claimed |
| Portability         | Export representable wire schemas, identify refinements outside JSON Schema, one Python/Go SDK and shared golden fixtures, incompatible-change CI                                                                  | OpenAPI generated; Zod remains authoring source                                           |
| Performance         | Representative payloads/concurrency, p95/p99, allocations/GC, event-loop delay, proxy overhead, slow readers, bounded memory, security parity                                                                      | Redundant interceptor roundtrip removed; no production throughput claim                   |

Trace context remains correlation, not deadline or authority. Trust/size rules must be defined before forwarding caller tracing fields. Stream reconnect must attach to an existing execution and never resubmit model work.

## Verification and evolution

See [HTTP audit](../reviews/HTTP-CONTRACT-AUDIT.md) and [Contract Operations](../development/CONTRACTS.md). Local unit, integration, Pact, and browser evidence must be reported independently. Passing tests does not close P0 review, external identity/Redis evidence, or P3.5 production gates. Revisit transport and serialization when a concrete consumer or measured bottleneck justifies it.

## Primary references

- [HTTP semantics: idempotency and retry](https://www.rfc-editor.org/rfc/rfc9110.html#section-9.2.2)
- [Zod object unknown-key behavior](https://zod.dev/api#objects)
- [Zod JSON Schema representability](https://zod.dev/json-schema)
- [Fastify validation and serialization](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/)
- [W3C Trace Context](https://www.w3.org/TR/trace-context/)
- [WHATWG server-sent events](https://html.spec.whatwg.org/multipage/server-sent-events.html)
