# HTTP Client, UI State, and FE/BFF/API Contract Audit

24 September 2026. Baseline commit: ccb86c9. Scope: implemented M0/M1 HTTP surface on the local workstation. Existing sign-in/layout edits are excluded and preserved. This is not a production audit certificate or a claim of superiority to another engineering organization.

## Historical checkpoint and current successor

This audit records the earlier ADR-0028 hardening revision, including its one-attempt policy and the then-remaining mapper/portability work. Subsequent [ADR-0029](../adr/0029-replay-resources-runner-authority.md) implements route-declared retries, receipt-backed resources, explicit mappers/AST gate, runner authority and updated OpenAPI. Do not read the historical policy or microbenchmark below as the complete current implementation. Use [CURRENT-STATE](../implementation/CURRENT-STATE.md) and [current verification](CONTRACT-EXECUTION.md).

## Findings and disposition

| Finding                                                                   | Impact                                                                                 | Disposition                                                                                                      |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Browser response.text() without a client deadline/byte bound              | Indefinite pending UI or oversized buffering; media-type rejection waited for the body | Cancellable full-request scope, bounded adaptive byte buffer, early protocol rejection                           |
| Strict nested Profile/CheckReport reused as response readers              | Additive nested response field broke a consumer                                        | Dedicated stripping wire views; strict request/domain schemas retained; failing regression reproduced before fix |
| Provider response JSON.stringify then JSON.parse before schema validation | Redundant full response traversal/allocation, duplicated upstream wire mapping         | Direct wire DTO validation; throwing-toJSON regression proves roundtrip removal                                  |
| Editor/scenario/key changed during an outstanding mutation                | An old response could render against a new request                                     | Generation-bound exclusive mutation state; stale completions ignored                                             |
| Pending flag covered secondary health refresh                             | Confirmed write still appeared pending; slow refresh blocked another action            | Write completion and health refresh have independent lifecycle                                                   |
| Query refresh swallowed failures                                          | Saved-result warning path could not see refresh failure                                | Explicit refreshOrThrow path only for dependent refresh; ordinary query refresh remains self-contained           |
| Unexpected transport abort restores an old snapshot as success            | Failed health could falsely become Healthy without a new successful probe              | Treat unowned abort as failed query, preserve last-known data without claiming recovery                          |
| Missing explicit unknown mutation outcome                                 | Lost acknowledgements could look like confirmed rejection/unsaved write                | ApiClientError outcome and UI unknown state; same-key replay guidance; no automatic retries                      |
| BFF upstream oversize mapped through request413                           | Server response failure misattributed to caller payload                                | Sanitized upstream502 with distinct code                                                                         |
| BFF masks all5xx as502 and drops retry hints                              | Lost overload/deadline/correlation information                                         | Preserve safe503/504 and bounded Retry-After/request ID, never raw server diagnostics                            |
| BFF waits not all covered by deadline; cancel could hang                  | Slow session/non-cooperative transport or cancel delayed return                        | Bounded await scope through session/fetch/body; best-effort nonblocking stream cancellation                      |
| All-or-nothing catalogue leaves sibling requests active                   | Unnecessary in-flight reads after aggregate failure                                    | Shared sibling cancellation with independent health query                                                        |

## Corrections to the supplied principal review

The extra interceptor roundtrip and missing browser bounds are real. A numerical claim that this service fails at 20,000 or 50,000 RPS is unmeasured; neither a workload nor CPU/latency profile was supplied. Binary protocols and compiled serializers do not establish application idempotency, exactly-once effects, or bounded replay by themselves.

Response strictness was not universal: most HTTP object schemas already stripped unknown fields. The reproduced hole was nested strict profile/report views. The correction does not relax authority-bearing requests or accept an unknown enum as success.

Idempotency fingerprinting already exists: M0 ZodContractPolicy hashes canonical kind/payload and PrismaValidationRepository rejects mismatches; the M1 admission repository also compares request digests. A min-length header schema is not the complete idempotency implementation. Existing database integration tests, rather than the header declaration alone, are the relevant evidence.

The audited client implements unary M0/M1 administration, not the planned AI execution stream. Buffering bounded unary JSON is intentional. The runtime still needs actual incremental SSE delivery and its replay/backpressure/failure gates. Existing streaming documents are design, not runtime proof.

OpenAPI is language-neutral as a wire artifact, but there is no independently verified Python/Go SDK here. Zod custom behavior is not automatically equivalent to JSON Schema. ADR-0028 defines the remaining portability acceptance work instead of claiming migration to an IDL was completed.

## Implemented policy and source locations

The shared policy is packages/contracts/src/http/behavior.ts and is included as x-runtime-behavior in generated OpenAPI. Browser ceilings: 30 seconds, 8 MiB response bytes, 64 KiB error diagnostics, one attempt. BFF retains configurable lower limits. UTF-8 is decoded strictly; actual bytes are counted. These are safety ceilings, not calibrated production SLOs.

Transport implementation: apps/web/src/shared/api/http-client.ts, request-scope.ts, bounded-response.ts, http-error.ts, lab-client.ts; server forwarding: apps/web/src/server/api-gateway/forward.ts. UI state: shared/api/mutation-state.ts and features/contract-lab/hooks/use-playground.ts. Provider validation: apps/api/src/shared/presentation/contract-route.ts and http-exception.filter.ts.

## Verification record

Initial regression: additive nested profile test FAILED on the old implementation with INVALID_RESPONSE, then PASSED after the wire-view change. The first post-change web suite passed44 tests; three new provider-interceptor tests passed. Expanded BFF, database, type/lint/build, Pact, and browser checks are recorded below when complete.

Final verification on this workstation:

| Check                                              | Result                                                   | Evidence                                             |
| -------------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------- |
| Full npm run verify                                | PASS, exit 0                                             | .local/http-hardening-verify.log                     |
| Request-contract tests                             | 30 PASS                                                  | verify log                                           |
| API unit tests                                     | 15 PASS                                                  | verify log                                           |
| Tooling/configuration tests                        | 17 PASS                                                  | verify log                                           |
| PostgreSQL integration tests                       | 30 PASS                                                  | verify log and .local/http-hardening-integration.log |
| Web/BFF/transport tests                            | 48 PASS                                                  | verify log                                           |
| Current/frozen Pact consumer/provider verification | PASS; intentional missing saved_checks response rejected | verify log                                           |
| Production Next.js build                           | PASS                                                     | verify log                                           |
| Client-bundle boundary                             | PASS, 39 client files and 15 manifests                   | verify log                                           |
| Browser E2E                                        | 18 PASS, fresh development server                        | .local/http-hardening-e2e.log                        |

The browser additions exercise slow secondary health refresh after confirmed save, late results after scenario change, payload/key edits during pending writes, unknown outcome with same-key manual replay, and unexpected transport abort after a failed health check. An unexpected abort is not promoted to a successful health observation. The final hook/test adjustment is also checked by the final targeted lint/type pass in .local/http-hardening-final-checks.log.

### Local serialization microbenchmark

Reproduce after building contracts: node scripts/benchmark-http-response.mjs. Fixture output equality is asserted; 9 alternating-order rounds follow warmup. Both paths include schema validation plus final JSON serialization. Only the before path includes the removed JSON stringify/parse normalization.

| Fixture             | Output bytes | Before median per iteration | After median per iteration |
| ------------------- | ------------ | --------------------------- | -------------------------- |
| One history record  | 554          | 0.00482045 ms               | 0.00193045 ms              |
| 100 history records | 52,430       | 0.288577 ms                 | 0.105817 ms                |

Node v24.11.1, Windows, shared development workstation. Raw samples: .local/http-hardening-benchmark.json. This is roughly 2.50x/2.73x for this isolated warm validation/serialization fixture only, not an API RPS result, latency SLO, GC measurement, or production speedup. Repository mapper normalization and BFF projection are not removed by this optimization.

No live provider, live Keycloak, deployed Redis, multi-language SDK, persistent Broker rollout, load/chaos test, or production traffic was exercised. No source commit/push is implied. User sign-in/style changes remain separate.

## Next acceptance gates

[ADR-0028](../adr/0028-http-behavior-and-outcome-semantics.md) records concrete completion criteria for end-to-end deadline propagation, streaming, retry ownership, language-neutral consumer fixtures, independent compatibility gates, and representative latency/allocation measurements. Preserve [P3.5](../PLAN.md) and [stream recovery](../contracts/EVENTS-STREAMING.md) gates; do not use a transport refactor to relabel unfinished runtime work as complete.
