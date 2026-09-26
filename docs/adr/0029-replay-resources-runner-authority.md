# ADR-0029 — Replay receipts, bounded resources, and runner authority

Date: 24 September 2026. Status: implemented locally; final verification recorded in [execution evidence](../reviews/CONTRACT-EXECUTION.md). No production approval or automatic provider execution is implied.

Extends [ADR-0028](0028-http-behavior-and-outcome-semantics.md), [ADR-0005](0005-leases-fencing.md), and [ADR-0008](0008-late-usage.md).

## Implementation reconciliation — 24 September 2026

Current source implements the receipt/resource/manual-runner-authority subset described below. Exhaustive routes, exact statuses, scope limits and later documentation checks are linked in the current implementation reference. See [current source state](../implementation/CURRENT-STATE.md), [active HTTP operations](../implementation/HTTP-API.md), and [verification scope](../reviews/CONTRACT-EXECUTION.md). This note updates implementation status only; it does not create new reviewer approval or erase the original decision history.

## Decisions

### Atomic management receipts

New resource mutations require Idempotency-Key. The durable unique scope is caller kind + authenticated subject + request key. The fingerprint includes schema version, operation kind, target identity, expected revision, and canonical command content. Tokens are not inferred authority and never replace authorization. A key reused for another command fails with IDEMPOTENCY_CONFLICT.

Mutation, audit, and completed receipt commit together in a short PostgreSQL transaction. Concurrent duplicates coordinate through a unique constraint and database transaction retries. An uncommitted claim is not advertised as a visible leased operation. A deferred database trigger rejects commits of incomplete receipts. Replay checks the completed receipt before re-evaluating expectedRevision. A new operation with stale expectedRevision still conflicts. No application lease, TTL-based takeover, or HTTP 425 is used for these synchronous mutations.

The replay window is seven days as an explicit initial safety policy, not a calibrated production retention guarantee. Expired keys are retained and rejected with REQUEST_KEY_EXPIRED (410); no cleanup job silently frees them. Retention/storage ownership requires operational calibration before production. Receipts return the historical operation result, not a promise that the resource still has that revision. Caller authorization is rechecked before access. Operator APIs currently use platform-wide roles within the single-organization deployment.

### Resource APIs and overview

The new /api/v1 collections expose independent list contracts. Mutations return one resource type plus receipt metadata. Profile revision publication and runner lifecycle are explicit actions. The console reads these collections independently and never needs the legacy full snapshot. Each collection has live keyset pagination with a maximum page size of 100, cursor resource/caller binding, and schema validation. Cursors are navigation state, not authorization tokens; authorization is applied independently.

Projection happens in database queries. Credential secret references and outbox payloads are not fetched by list readers. The overview contains counts and labels them independent observations, not an atomic cross-resource snapshot. Page response limits supplement projection and input field limits; they do not constitute a global process-memory or p99 guarantee. Oversized pages fail instead of silently truncating data.

The legacy /api/m1 surface remains a compatibility interface, not the console data path. Its snapshot rejects overflow and management response variants are explicitly tagged to avoid additive-field branch confusion. New clients use resource endpoints. No migration removes old routes or silently repurposes their idempotency semantics.

### Client retry ownership

Automatic retry is declared per operation, never inferred just from a header. Receipt-backed management, M0 validation, and M1 admission permit up to three total HTTP attempts. Other operations default to one. One client instance owns a bounded retry-token budget. BFF forwarding does not add retries. An outer monotonic deadline covers every attempt, body read, and backoff; it is not reset. Key and serialized payload remain identical. Retry respects jitter, transient-failure classification, server refusal, Retry-After, caller abort, and remaining time. A hint beyond remaining time suppresses retry.

A lost acknowledgement keeps the mutation outcome unknown until an authoritative response arrives. Exhausted retries do not imply rollback. UI pending includes automatic retries, confirmed success ends the mutation before secondary health refresh, and late results cannot overwrite another editor generation.

### Runner protocol and fencing

A separate runner v1 HTTP/JSON binding publishes protocol metadata and typed start/result-proposal/evidence messages. Operator assignment grant/revoke uses request receipts. Runner routes are excluded from browser exposure; each message is authenticated and checked against assignment identity, owner subject, execution/attempt, exact generation, and epoch. Execution row locking serializes grants, revocation, and reports. Runner lifecycle checks are locked against concurrent updates. Durable generation is never adopted from a runner-supplied greater number.

Revocation increments the durable generation barrier. Stale or future tokens cannot write authoritative state. Result reports create bounded proposals and one outbox event, not official execution completion, artifact promotion, or budget settlement. Proposed results continue to occupy assignment capacity until ownership is resolved. Epoch is persisted; automatic Redis epoch recovery is not implemented by this change.

Late evidence from a known old assignment is retained as QUARANTINED with source-identity deduplication. It cannot update the ledger directly. Existing authorized accounting ingestion remains separate. Automated evidence verification, dispatch, Redis heartbeat leases, sandbox supervision, live provider execution, and full replayable SSE are not claimed by this patch. Fencing a platform write cannot undo an external provider call that already occurred.

### Serialization boundary

Explicit wire mappers replace stringify/parse normalization. The database JSON validator checks plain finite JSON, bounded depth/node count and encoded bytes, rejects accessors/non-JSON values, and does not deep clone through serialization. CI runs serialization:check over authored API source. Its AST rule detects direct and supported local-alias roundtrips; it is not whole-program taint analysis. Generated code is excluded. Legitimate final serialization and JSON parsing remain allowed.

## Verification and rollback

Tests cover two-API-instance receipt concurrency, lost acknowledgements, revision conflicts, rollback, expiry, authorization, keyset scope, projected secrets/outbox payloads, stale/future runner tokens, proposals, restart and quarantined evidence. Browser tests cover actual post-commit lost acknowledgements, automatic same-key replay, collection pagination and isolated failures. Test fixtures are uniquely scoped; no database reset is part of verification.

Migrations 0005 and 0006 are additive. Rolling application rollback must preserve receipt and authority tables and must not route receipt-backed mutations to an older server that ignores their contract. Before exposing runner v1 outside the controlled environment, publish its supported-version policy and verify real deployment/network failure conditions. Do not drop tombstones or fencing generations to perform a rollback.

## Final wire-artifact and consumer checks

OpenAPI now distinguishes API bearer principals from server-owned browser sessions and documents correlation/retry response headers. Browser generators can be given the deployment cookie name; the generic artifact explicitly describes the complete Cookie header without inventing that deployment value. Response schemas describe tolerant consumer acceptance while preserving known required fields; producer response projection remains enforced in API/BFF code. Superseded snapshot/list operations advertise migration without falsely deprecating still-required legacy admission.

Current Pact expectations now include bounded overview and paginated application reads in addition to the frozen v1 compatibility fixtures. Concurrent grant/revoke and proposed-result capacity checks are part of the final database suite. See the final [verification record](../reviews/CONTRACT-EXECUTION.md); these checks do not imply universal SDK or production compatibility.
