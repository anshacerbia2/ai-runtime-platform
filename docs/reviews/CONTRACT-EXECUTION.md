# Contract evolution — implementation evidence

24 September 2026. Status: implemented and verified locally for the final API-contract decisions in [ADR-0029](../adr/0029-replay-resources-runner-authority.md). The [request closure matrix](REQUEST-CLOSURE.md) maps requirements to implementation and tests. This is not a production approval or a claim of superiority to another organization.

## Revision boundary for later documentation

This is the recorded implementation closure at the source digest below. The later docs-only reconciliation is recorded in [DOCUMENTATION-SYNC](DOCUMENTATION-SYNC.md). Subsequent local source edits are not silently covered by this earlier PASS. [Current implementation](../implementation/CURRENT-STATE.md) distinguishes behavior, tested scope and remaining target work.

## Verified source

Base Git HEAD: ccb86c941ecdd703d2f0df3d86d7b794b40db484. Implementation remains in the working tree; review HEAD alone will show the earlier code. No commit or push was made.

Final source/test/configuration digest (SHA-256): 03a22e6966aaf02eb76d9bad4887c5ff7d20698579d963c98b2cea870952f4a2. Per-file hashes are recorded in .local/contract-final-source-snapshot.json. The digest excludes this documentation and generated build output. The runtime source was unchanged between the passing managed E2E run and the closing verification; one additional gateway regression was added afterwards and included in the closing checks.

## Delivered implementation

Atomic management request receipts with optimistic revision control and retained expiry; independent resource APIs with keyset pagination and database projection; count-only overview; versioned runner authority with exact fencing and late-evidence quarantine; bounded operation-owned client retry; explicit mappers; serialization AST gate; independent UI health/catalogue/mutation outcomes.

The final pass also completed OpenAPI authentication/response-header descriptions, tolerant consumer schema export, current Pact expectations for the new overview/page endpoints, and extra concurrent fence/capacity tests. The valid colon-ID BFF path is covered by a regression test.

## Database

Migrations 0005_contract_receipts and 0006_runner_authority are applied to the configured local PostgreSQL database. The final migration-status command reports all six migrations up to date. Existing data was not reset. Tests use uniquely scoped fixtures and clean up only their own records.

## Verification

| Check                                               | Result                                     | Evidence                                        |
| --------------------------------------------------- | ------------------------------------------ | ----------------------------------------------- |
| Full npm run verify                                 | PASS, exit 0                               | .local/contract-closure-verify.log and .exit    |
| Request-contract tests                              | 30 PASS                                    | Closing verify log                              |
| API unit tests                                      | 19 PASS                                    | Closing verify log                              |
| Tooling/configuration/AST tests                     | 27 PASS                                    | Closing verify log                              |
| PostgreSQL integration/fault tests                  | 40 PASS                                    | Closing verify log                              |
| Web/BFF/transport/contract tests                    | 58 PASS                                    | Closing verify log                              |
| Current/frozen consumer-provider Pact               | PASS; 11 current interactions per boundary | Closing verify log; frozen fixtures unchanged   |
| Deliberately broken required response field         | Rejected as expected                       | Negative CDC proof in verify log                |
| Production Next.js build and client bundle boundary | PASS                                       | Closing verify log                              |
| Migration status                                    | PASS, exit 0                               | .local/contract-final-migration-status.log      |
| Browser E2E on a fresh owned server                 | 21 PASS, exit 0                            | .local/contract-final-e2e-managed.log and .exit |
| Earlier independent browser confirmation            | 21 PASS, exit 0                            | .local/contract-final-e2e-recheck.log           |

The first browser attempt executed all scenarios but hung during npm-wrapper cleanup; that attempt is not counted as a successful complete run. The test server command was simplified to node scripts/dev.mjs and the managed rerun completed with exit 0. No assertions or security-origin checks were disabled.

Integration evidence includes concurrent receipts across two API harness instances, lost acknowledgements, genuine revision conflict, atomic rollback, incomplete-receipt rejection, expiry, caller/cursor isolation, secret/outbox projection, exact runner tokens, restart, concurrent grant/revoke, retained capacity for proposals and quarantined evidence without ledger mutation. Browser evidence includes a real committed write whose first response is dropped and safely replayed with the same key/body.

The two API instances are local harness instances, not geographically distributed machines. The seven pre-existing sign-in/layout files remain byte-identical to the captured hashes. Final runtime/source readback is checked against the verified digest.

## M0–M2 local closure — 26 September 2026

A fresh closure run on the working tree above HEAD `67c5bf5` completed with `npm run verify` PASS exit 0 and browser E2E 21/21 PASS. The local PostgreSQL database is migrated through `0010_m2_invocation_route`; generated OpenAPI matches source. The passing verify includes 31 contract tests, 35 API unit tests, 27 tooling/configuration tests, 47 PostgreSQL integration/fault tests, and 60 web/BFF tests. Current/frozen Pact verification remains positive; the deliberately broken `saved_checks` provider proof is rejected as expected and therefore prints a negative verification failure inside an overall passing gate. Evidence: `.local/zod-hardening-verify2.log` and `.local/zod-hardening-e2e.log`.

This closure also makes the Zod response-evolution policy executable: HTTP wire schemas are projection-only and cannot use transform/default/catch/preprocess/coercion; provider responses project declared fields so internal properties cannot leak; generated OpenAPI explicitly declares additive consumer compatibility. The gateway evidence covers dual adapter conformance, bounded SSE/replay, structured-output failure without rewriting provider success, safe `not-sent` fallback with a durable second attempt, ambiguity without response splicing, and database-backed application/connection admission caps.

## Remaining runtime/deployment boundaries

No authorized live OpenRouter/Anthropic smoke is claimed on this workstation because provider credentials are unavailable. Autonomous dispatcher/reassignment, Redis heartbeat/epoch-recovery coordinator, external sandbox supervision, agent-runtime tools/workspace/session handling, cross-language SDK conformance, production Broker rollout and calibrated production load/chaos certification remain open. Local gateway SSE/replay is implemented; local browser/BFF request deadlines are not an end-to-end provider cancellation guarantee. These are P3/P3.5 or deployment gates, not reasons to reopen the local M0–M2 implementation closure.
