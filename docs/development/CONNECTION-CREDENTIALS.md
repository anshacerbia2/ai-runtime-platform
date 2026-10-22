# Gateway credentials per AI connection

**Checkpoint:** 22 October 2026 (Asia/Jakarta). Implements the existing [ADR-0019](../adr/0019-application-connections-credentials.md) credential boundary for central API-key connections. This is working gateway composition with a deployment-injected configuration source; it is not approval of a production secret-manager product, live vendor use or the Agent Runtime proposal.

## Runtime path

The profile selects a registered connection server-side. Gateway admission/claim selects one enabled CENTRAL credential and captures its metadata ID, revision and secret reference. Each invocation already durably records its `connectionId`; the new resolver uses that exact server-selected context to obtain its key, instead of selecting one global key merely by provider name.

Before and after lookup, a bounded PostgreSQL transaction checks the application, pinned profile route, enabled API_KEY connection, enabled central credential with the exact ID/revision/reference, current application/profile binding, running invocation/attempt and owner instance, plus execution cancellation/status. A changed/revoked credential or authority fails before transport. No provider or secret-source I/O runs inside the database transaction.

The final successful check is the local dispatch-admission point. A disable/cancel committed first denies new dispatch. Changes committed after that admission can race with already admitted/in-flight I/O; no PostgreSQL check can recall a provider request already sent. Existing unknown-outcome, cancellation, fallback and accounting rules remain applicable.

Both OpenRouter and Direct Anthropic adapters resolve through this port. Redirects are refused. Resolver failures are sanitized `PROVIDER_CREDENTIAL_UNAVAILABLE` with `not-sent` outcome; source errors/keys/references are not attached as error causes or attributes. Abort/deadline can end the adapter wait even when a source is uncooperative, and late resolution never sends HTTP. A transport failure after dispatch remains ambiguous and is not retried as a credential lookup.

## Explicit source configuration

`M2_PROVIDER_CREDENTIALS_JSON` belongs only to the API projection of the existing single [environment gate](CONFIGURATION.md). It is an array of exact objects:

```json
[
  {
    "connectionId": "registered-account-a",
    "provider": "openrouter",
    "credentialRef": "secret:account-a/v1",
    "apiKey": "INERT_EXAMPLE_REPLACE_THROUGH_APPROVED_SECRET_INJECTION"
  }
]
```

This example is not a live credential or a seed operation. Register the connection, central credential metadata carrying the same opaque reference, application/profile binding and immutable profile through the authorized management path. Actual secret values come from the deployment's approved mechanism and must not be committed to Git, inserted into PostgreSQL metadata or delivered to the browser. Never print the configuration object while troubleshooting.

Matching requires the full `(connectionId, provider, credentialRef)` tuple. A reference belonging to another connection/provider is not an alias or a fallback; the resolver never interprets it as an arbitrary environment variable name, filesystem path, URL or Vault lookup. Different connections on the same provider can use different keys. An empty/missing array leaves unconfigured credentials unavailable.

The parser permits at most 64 entries and 64 KiB of UTF-8 JSON. Fields are exact; duplicate tuples, unsupported providers, control characters, empty/oversized values and malformed JSON fail with a fixed message that does not echo input. Connection IDs are at most 160 characters, references 512, and keys 1–8192 printable ASCII characters without spaces. The source captures immutable copies and hides key containers from ordinary object serialization. Strings/HTTP headers/environment copies are not claimed to be securely erasable memory.

Legacy `M2_OPENROUTER_API_KEY` and `M2_ANTHROPIC_API_KEY` remain only for `m0-local` compatibility and their exact legacy references. Nonlocal startup rejects nonempty legacy keys; migrate those deployments to explicit bound configuration before rollout. The nonlocal source has no provider-global fallback. Nonlocal identity, Redis and other existing startup requirements still apply; configuring credentials does not bypass them.

The configuration source is captured for a process lifetime. Rotation uses a new secret reference/version and credential metadata revision plus coordinated configuration rollout/restart. An in-flight claim carrying an older revision is refused at the next credential gate; a request already dispatched may still complete or incur cost. Automatic Vault refresh, OAuth/workload identity exchange, secret-manager revocation SLA and transparent hot rotation are not implemented. O05/O14 remain open for the actual deployment.

## Attribution and monitoring boundary

ProviderInvocation retains execution, attempt, connection, provider/model, request identity and observed token counts. UsageObservation coverage references the invocation ID; ledger posting remains owned by the existing accounting path. Connection attribution is obtained through those references, not by creating a second account charge. Same-key replay reads the same execution without another invocation or posting.

Selected credential ID/revision is currently an in-memory dispatch pin, not a new durable credential-version history on ProviderInvocation. No schema migration or new public account/usage endpoint is introduced. The existing Connections/Credential metadata tables still omit secrets and secret references. Budget units/held/posted balances are internal accounting values, not a vendor balance. The aggregated per-account/time-period usage dashboard, provider quota/balance synchronization and health/alert views remain separate implementation work.

## Verification and rollout

- Focused local tests: `node --import tsx --test apps/api/test/unit/gateway-credentials.test.ts apps/api/test/unit/gateway-providers.test.ts apps/api/test/unit/gateway.test.ts` and `node --test scripts/test/provider-credentials.test.mjs`.
- Configuration projection tests run in the existing tooling suite with disposable CI configuration. They verify API-only key material, fixed configuration errors and nonlocal refusal of global legacy keys.
- `apps/api/test/m2.integration.test.ts` adds the actual `api-production` module composition with local fixture authentication, real PostgreSQL and a loopback HTTP provider. Two connections on one provider use distinct keys; invocation/token/usage/ledger attribution and exact replay are asserted. It also checks credential/application/connection/binding revocation, metadata revision changes, wrong ownership and cancellation, including revocation during source lookup. This is not nonlocal OIDC or live-provider evidence.

Keep local/CI fixtures separate from staging/production stores and credentials. Deploy the new configuration before starting code that rejects legacy nonlocal keys; verify authorized connection/binding/profile setup without exposing keys. Bounded live smoke must be separately authorized and scoped to an approved account/budget before production claims. Preserve invocation/evidence/holds on rollback. Rolling back to older code cannot resolve these new references; drain or suspend affected work and restore a compatible credential configuration rather than replaying uncertain calls.
