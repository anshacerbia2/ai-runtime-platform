# Shared HTTP Contracts and Consumer Compatibility

The canonical runtime route definitions and Zod schemas live in `packages/contracts/src/http`. Nest handlers, browser operation clients, BFF exposure rules, and generated OpenAPI consume them. M0–M2, including the gateway `/v1` execution/SSE surface, are active locally; machine-only runner routes remain explicitly separate from browser exposure.

## Local checks

```powershell
npm run contracts:export
npm run contracts:check
npm run contracts:boundary
npm run typecheck
npm run test:cdc
npm run verify
npm run test:e2e
```

`test:cdc` requires the existing local PostgreSQL test setup, creates unique application fixtures, and deletes only those fixtures. It never resets the database. The Pact mock providers and the BFF provider adapter listen on ephemeral loopback ports. No real issuer or provider account is contacted.

Consumer tests invoke the same inferred client/forwarder used by the product. Current Pact files are generated under `.local/pacts/current`; frozen consumer expectations are committed under `tests/cdc/baselines/v1` and are not overwritten by generation. Preserve old supported consumers when adding a new baseline. The deliberate incompatibility probe prints an expected Pact failure, then passes only when verification rejects the broken response.

## Framework and type boundaries

The Nest binding validates requests and explicit mapped wire DTOs before serialization and uses contract-derived handler return types. Web features never supply a free generic DTO to an untyped URL. Only transport/SDK glue handles `unknown`; feature response shapes are inferred. The mechanical boundary check rejects reintroduced implemented API endpoint literals and duplicate wire interfaces in the client code.

The selected ts-rest core version is pinned and release-candidate, because the current stable line does not support this project's Zod/Nest combination. No peer compatibility checks are disabled. See [ADR-0027](../adr/0027-shared-rest-consumer-contracts.md).

## Status and error handling

`ApiClientError` distinguishes HTTP, transport, timeout, cancellation, and invalid response errors and preserves correlation identifiers. Error fields are checked against shared schemas. Automatic retry is operation-declared: receipt-backed resource mutations, lab validation, and admission allow up to three attempts within one deadline; other mutations remain one-attempt. Empty success bodies require an explicit no-body response in the endpoint contract.

Catalogue loading, health checks, and editor/mutation errors have independent lifecycles. Closing an error message cannot change a health observation. Failed checks show unconfirmed/unknown state and clearly labelled last-known values; a durable save is not changed into failure because a secondary health refresh failed.

## Current coverage and contract sources

[HTTP-API](../implementation/HTTP-API.md) lists the active operation catalogue and browser exposure. routes.ts composes resources.ts, runner.ts, and gateway.ts; `/v1` execution and SSE event routes are active for M2 while machine-only runner operations remain excluded from the browser contract. OpenAPI includes provider/browser authentication models, optional response correlation/retry headers, additive consumer compatibility, producer projection policy, and legacy replacement notes. The generation format is documentation metadata; it does not automatically create an independently verified Python/Go SDK.

Current Pact consumers contain eleven interactions per hop, adding bounded overview and application-page reads to the original nine. Frozen baseline files retain their original expectations. This is not exhaustive Pact coverage of all 53 operations; remaining management/runner behavior is checked by shared schemas and integration/fault tests. [Expectations](../../tests/cdc/expectations.ts) are consumer-authored, not copied from provider validators.

The client RetryBudget and one monotonic timeout are local process policies. BFF adds no retries and cannot promise API/provider transaction cancellation. Run npm run serialization:check as part of verification. Latest completed evidence and documentation-only reruns remain separate in [CONTRACT-EXECUTION](../reviews/CONTRACT-EXECUTION.md) and [DOCUMENTATION-SYNC](../reviews/DOCUMENTATION-SYNC.md).

## Persistent Broker pipeline

These commands require the explicit Pact environment projection in `config/environment.mjs`:

```text
PACT_BROKER_BASE_URL    HTTPS Broker origin (HTTP only for loopback tests)
PACT_BROKER_TOKEN       Required for nonlocal Broker
PACT_VERSION            Full 40-character Git SHA of the tested source
PACT_BRANCH             Actual consumer/provider branch
PACT_ENVIRONMENT        Exact destination environment
PACT_TIMEOUT_MS         Bounded Broker command deadline
```

Do not put credentials in the repository, CLI arguments, or chat. Configure the environment through the existing root gate or CI secrets.

```powershell
# Consumer CI: create expectations, then publish this tested source version.
npm run cdc:consumer
npm run cdc:publish

# Provider CI: build/start verification fixtures, fetch selected consumer versions,
# verify actual providers, and publish provider results.
npm run build -w @ai-runtime/api
npm run cdc:verify:broker

# Before rollout: use the exact participant and commit being deployed.
npm run cdc:can-i-deploy -- runtime-api

# Only AFTER successful actual rollout:
npm run cdc:record-deployment -- runtime-api
```

The web deployable contains both `runtime-console` and `runtime-bff` compatibility roles. A web rollout must check both roles and record both versions after success. API rollout checks `runtime-api`. Missing credentials/results, incompatible consumers, and unknown versions fail closed. Never use dry-run, latest-version shortcuts, ignored consumers, or disabled TLS verification.

`.github/workflows/contract-deploy-gate.yml` is a reusable gate. The actual deployment job must depend on it using `needs`; copying a gate into an unrelated workflow is not enforcement. No production rollout workflow or persistent Broker has been guessed or provisioned in this repository.

## Isolated CI deployment proof

`cdc:broker-proof` is restricted to a loopback Broker and the `contract-ci` environment. CI provisions disposable Broker/PostgreSQL services, publishes current and frozen consumers, publishes positive and intentionally negative provider results, records simulated deployed versions, and checks the matrix. Compatible candidates must pass, while a known incompatible version and an unverified version must fail. The simulated records are test evidence, never production deployment records.

See [Configuration](CONFIGURATION.md) and [Validation](../reviews/VALIDATION.md).

## Behavioral contract and mutation outcome hardening

See [ADR-0028](../adr/0028-http-behavior-and-outcome-semantics.md) and the [HTTP audit](../reviews/HTTP-CONTRACT-AUDIT.md). The shared unary policy and exported x-runtime-behavior add explicit safety ceilings and replay semantics. Browser and BFF deadlines cover their local awaits, not an end-to-end API transaction cancellation guarantee. Request abort never proves rollback.

Mutation lifecycle is idle/pending/success/error/unknown, independent of health and catalogue query state. An acknowledged save is successful even while health refresh is pending or fails. A transport/protocol failure after dispatch can leave the write outcome unknown; reconcile or replay the same key and canonical payload. Automatic retries now follow ADR-0029 per-operation declarations: up to three attempts for eligible keyed writes, one otherwise. Retry-After supplies a bounded delay hint and does not authorize replay.

Zod wire contracts are projection-only: transforms/defaults/catch/preprocess/coercion are blocked by a fitness test. Command/request schemas remain strict where authority requires closed input. At the provider boundary, validated responses are projected to declared fields so accidental internal properties cannot leak; at the consumer boundary, generated OpenAPI explicitly declares additive unknown-property tolerance so older readers can ignore newly published fields. The provider interceptor validates already-mapped wire DTOs without JSON roundtripping, and the BFF still reprojects sanitized response fields. No Python/Go consumer conformance is asserted.

## Resource and runner extensions

New clients use /api/v1 resource operations and count-only overview; /api/runner/v1 is a separate machine-only binding. Mutation receipts, cursor rules, retry budgets, and runner authority are defined in [ADR-0029](../adr/0029-replay-resources-runner-authority.md). Run npm run serialization:check, npm run verify, and npm run test:e2e. See [current execution evidence](../reviews/CONTRACT-EXECUTION.md).
