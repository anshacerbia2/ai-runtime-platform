# Acceptance, Conformance, dan Production Gate Catalogue

**Baseline 0.2. Semua implementation tests di bawah berstatus NOT RUN.** Dokumentasi ini mendefinisikan pengujian; bukan laporan test lulus. Phase P3.5 memerlukan evidence dari build/deployment nyata.

## 1. Gate protocol

Setiap test merekam ID, invariant, build/runtime/profile digest, environment, fixtures, fault/load parameters, expected assertion, observed result, trace/log/ledger evidence reference, timestamp, dan reviewer. Artifact evidence harus immutable/scoped. Unit test, adapter fake test, integration test, live smoke test, dan chaos test dibedakan.

Applicable tests wajib pass sebelum production cutover. N/A hanya untuk capability yang benar-benar tidak dipakai dan disetujui reviewer; direct-chat pilot tidak otomatis mewajibkan plugin runtime, tetapi ledger/auth/SSE/route gates tetap berlaku. Principal source sign-off bukan runtime evidence.

## 2. Catalogue

| ID  | Scenario / injected fault                                                                             | Required assertion                                                                                                | Layer / phase              |
| --- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------- |
| G01 | App A mencoba read/list/cancel/stream/artifact/session/usage App B; forged application identity/scope | Semua unauthorized access ditolak, no cross-scope data                                                            | Security integration / P1  |
| G02 | Concurrent same key, different body, response lost, profile alias moved                               | One logical execution/hold; conflict on changed digest; replay retains snapshot                                   | API + DB / P1              |
| G03 | Same common fixtures OpenRouter and Direct Anthropic                                                  | Request/result/error/usage mapping passes; unsupported features explicit                                          | Adapter / P2               |
| G04 | Kill worker during turn; replacement; old worker sends result                                         | Orphan detected within calibrated bound; after durable fence old state/result rejected                            | Runtime chaos / P3         |
| G05 | Expired/missing lease; wrong owner/generation/epoch renew                                             | Renew fails, no key recreation; old worker cannot start new protected step                                        | Coordination / P3          |
| G06 | Redis restart/failover/state loss during active attempts                                              | Dispatch paused, new epoch/reconciliation, no stale authority restored                                            | Integration chaos / P3     |
| G07 | 50 requests, 3 units available, one-unit hold each                                                    | Exactly 3 admitted, 47 denied; held=3, available=0; denials no decrement                                          | DB race / P1               |
| G08 | Crash before/after settlement commit and before/after projection                                      | One charge/adjustment; no duplicate release; Redis rebuilt by revision                                            | Financial integration / P1 |
| G09 | Crash after admission before response/dispatch; duplicate outbox                                      | Hold/execution survive; same key returns same; dispatch idempotent                                                | DB/outbox / P1             |
| G10 | SSE disconnect 15s then resume within retained window                                                 | Remaining events replay/dedup; no new provider call/attempt                                                       | Stream / P2                |
| G11 | Resume after age/byte eviction or stream epoch loss                                                   | 410/reset with authorized snapshot; no invented missing prefix                                                    | Stream / P2                |
| G12 | Late usage at 5m and beyond 15m; stale generation and forged evidence                                 | Official state unchanged; valid evidence posts once; older evidence can be verified/adjusted; invalid quarantined | Accounting / P3            |
| G13 | Receiver commits mutation, worker dies before receipt stored                                          | Status lookup same operation key; no blind duplicate action; app sees uncertainty                                 | Tool chaos / P3            |
| G14 | Same key same input, same key different input, receiver retention expired                             | Reuse/return original; conflict; no unsafe auto-retry past retention                                              | Tool conformance / P3      |
| G15 | Duplicate/cumulative usage; parent+child overlap; price correction                                    | No double charge; verified revision delta/adjustment; null remains unknown                                        | Ledger / P1                |
| G16 | Structured output invalid/refusal/truncated/schema mismatch                                           | Not promoted as validated success; app domain validation still required                                           | Gateway/application / P2   |
| G17 | Primary outage before call versus after partial stream/ambiguous acceptance                           | Only policy-safe fallback; attempt boundary retained; no spliced final response                                   | Routing / P2               |
| G18 | Host mount/socket/env read, metadata/SSRF, privilege escalation, prompt-driven tool grant             | Host/control secrets unavailable, unauthorized egress/operation denied, logs redacted                             | Sandbox/security / P3      |
| G19 | Upload incomplete; object success then DB finalization crash; stale manifest                          | No premature result promotion; authorized idempotent finalize or quarantine                                       | Artifacts / P3             |
| G20 | Concurrent session writers, replay after revision advanced, incompatible runtime                      | One writer; no repeated message; explicit conflict/restart                                                        | Session / P3               |
| G21 | Complete/cancel race; normal runtime error; chat done with late billing                               | CAS winner stable; no forced SIGKILL for normal failure; completion independent of settlement                     | State/API / P2–P3          |
| G22 | Batch/agent load alongside interactive traffic; slow clients                                          | Per-pool/app cap enforced; bounded memory; measured app latency/quality                                           | Load / P2–P3.5             |
| G23 | DB/Redis network split while streaming/in-flight call                                                 | No unrecorded new spend/mutation; bounded presentation; explicit resync/unknown, eventual reconciliation          | Chaos / P3.5               |
| G24 | Retention deletion, backup restore, old-worker resurrection, orphan object                            | Data policy honored, epoch/fence renewed, holds/idempotency retained, cleanup auditable                           | Operations / P3.5          |
| G25 | Multi-turn/retry/subagent envelope exhausted; actual overage                                          | Next dispatch blocked without allocation; existing costs recorded; pending hold not silently released             | Budget/runtime / P3        |

## 3. Calibrated principal scenarios

Worker candidate H=5s/L=15s/R=5s. Define t0 as kill injection, last confirmed renewal, scheduler/network allowance delta, and measured orphan detection time. Nominal L+R=20s excludes delay; test threshold must include predefined justified delta and observed environment. Do not move goalposts after measurement.

SSE test records retention age plus byte caps and earliest cursor. Budget race includes balance conservation, not only HTTP counts. Late-usage test compares expected fixture charges and unresolved cases; one matching fixture is not universal 100% accuracy. Sandbox test checks actual host/control secret isolation, not merely whether one path returns Permission Denied.

## 4. Quality fitness functions

App owners provide golden datasets/acceptance criteria for fare interpretation, translation/verification, RAG citations/ACL, and document rendering. Measure cost per accepted output, repair/retry rate, and latency distributions. Model/provider upgrade reruns affected fixtures. Scores/thresholds belum diberikan sumber; O08 blocks cutover until approved.

## 5. Property/invariant tests

INV-01/02 verified through app boundary/no-fake-job fixtures; INV-03/11 through G01/G18; INV-04 through G02/G09; INV-05 through G04–G06; INV-06 through G13/G21; INV-07 through G07–G09/G25; INV-08 through G12/G15; INV-09 through G21; INV-10 through G10/G11; INV-12 via gate record.

Randomized schedules/property tests should explore duplicate/reordered commands, crash windows, stale generation, cumulative evidence corrections, expired tokens, and deletion/restore. Fixtures include zero-call failures, missing provider IDs, partial output, and receiver UNKNOWN.

## 6. Evidence report template

```text
Gate ID / applicable capability:
Build + adapter/runtime/profile digests:
Environment / topology / clock assumptions:
Input fixture + expected outcomes:
Fault/load parameters + measurement window:
Observed state / ledger / side effects:
Evidence references + checksums:
Result: PASS | FAIL | NOT RUN | N/A (justification)
Reviewer / date / unresolved risks:
```

## 7. Launch blockers

Any stale write after durable fence, duplicated stateful effect from platform retry, budget denial mutation, duplicate credit, cross-application leak, web authentication/session bypass, unbounded agent credential access, or fabricated zero usage blocks launch. Missing required parameter/credential/data-policy/rollback decision also blocks launch.

Performance misses are assessed against pre-agreed SLO/error budget; safety misses are not waived by average good performance. Every release repeats impacted gates, not necessarily all unrelated capabilities.

## 8. Registry, credential, plugin, dan fleet acceptance

| ID  | Scenario / injected fault                                                                                         | Required assertion                                                                                                                                                      | Layer / phase           |
| --- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| G26 | App A requests connection/profile/plugin bound only to App B                                                      | Denied before dispatch; existence knowledge gives no authority                                                                                                          | Control/security / P1   |
| G27 | Inspect API/log/browser/plugin/heartbeat during credential use and rotation                                       | No secret/session material exposed; rotation/revocation auditable                                                                                                       | Security / P1–P3        |
| G28 | Dedicated connection cross-app use; shared connection allow-list and quota group                                  | Dedicated denied; shared only explicit apps; charge/rate scope retained                                                                                                 | Control/gateway / P1–P2 |
| G29 | Forged/duplicate runner registration; runner DRAINING/OFFLINE/DISABLED                                            | Identity takeover denied; no new assignment to ineligible node                                                                                                          | Fleet control / P1–P3   |
| G30 | Runner-local credential exists only on node A; scheduler sees A and B                                             | Only eligible node with valid locality/binding receives execution                                                                                                       | Placement / P3          |
| G31 | Same logical upstream account available on multiple runners/keys                                                  | Shared quota group enforced; capacity not multiplied by runner count                                                                                                    | Gateway/fleet / P2–P3   |
| G32 | Plugin digest mismatch, revoked version, incompatible runtime/permission                                          | Execution fails before plugin code runs; reason auditable                                                                                                               | Plugin security / P3    |
| G33 | workspace none plus artifact workspace traversal/unauthorized ref/oversized output                                | No fake workspace for none; invalid artifact/path never promoted                                                                                                        | Workspace/artifact / P3 |
| G34 | Optional MCP/HTTP remote tool with retry after ambiguous mutating outcome                                         | Integration is optional; stable operation identity/status reconciliation prevents blind duplicate                                                                       | Tool conformance / P3   |
| G35 | Drain/node loss/failover while execution active and connection also exists elsewhere                              | New placement excludes node; recovery/fencing prevents duplicate authoritative execution/effect                                                                         | Fleet chaos / P3.5      |
| G36 | Entry page unauthenticated; sign-in action; existing realm session; missing realm session; malformed callback URI | One sign-in action reaches Keycloak with the registered client; existing realm session returns without a second prompt; callback/logout URIs match registration exactly | Web identity / P1       |
| G37 | Inspect browser storage/responses and client bundle; expired token; session cookie tampering; app logout          | No access/refresh token or client secret reaches the browser; refresh happens server-side; tampered session rejected; logout clears only the platform session           | BFF security / P1       |
| G38 | Shared UI component states + token scanner + phone/tablet/desktop viewport                                        | No forbidden raw visual values outside token adapter; canonical states accessible; visual regression stable; no horizontal overflow at any viewport                     | Frontend quality / P1+  |
| G39 | Request without a session to a BFF route; BFF attempt at direct database access; framing attempt                  | Unauthenticated BFF route rejected before any API call; BFF holds no database connection; framing denied                                                                | BFF boundary / P1       |
