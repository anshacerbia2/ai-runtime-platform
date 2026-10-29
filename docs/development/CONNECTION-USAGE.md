# Per-connection usage reads

Checkpoint: 29 October 2026 (Asia/Jakarta). This read API implements operator reporting over existing PostgreSQL invocation/evidence/ledger records, following [ADR-0007](../adr/0007-durable-accounting.md), [ADR-0008](../adr/0008-late-usage.md) and [connection credentials](CONNECTION-CREDENTIALS.md). It does not change admission, settlement, credential custody or the approved architecture.

## Contract and authority

`GET /api/v1/connections/:id/usage` requires an operator with `platform:read` and the existing platform-operator/platform-admin role. Applications and runners cannot read this global operator view. The shared resource contract explicitly exposes the same read through the session-authenticated BFF; this slice adds no dashboard controls. Existing bearer/session, host/origin and response projection rules apply. Query fields are strict:

| Field             | Meaning                                                                                                       |
| ----------------- | ------------------------------------------------------------------------------------------------------------- |
| `from`, `to`      | Required offset-aware ISO timestamps with exactly millisecond precision; positive interval of at most 31 days |
| `applicationId`   | Optional registered application filter; omission includes all applications using this connection              |
| `budgetAccountId` | Optional single registered budget account; omission returns `ledger: null`                                    |

Unknown connection/application/budget identifiers return 404. Invalid windows, identifiers, extra/repeated fields return 400. Unauthorized principal kinds/scopes/roles return 403. The response contains no prompt/output, credential ID/reference/key, upstream request ID or individual execution/attempt identity.

## Cohort and measurement semantics

The half-open interval `[from, to)` selects invocations by their durable `started_at`, scoped to the exact connection and optional application. It is an invocation cohort, not a ledger-posting-period report, invoice or vendor balance. A request started at `from` is included; one started at `to` is excluded. Tokens/status reflect the current committed records, including a completion after `to`. Later verified ledger adjustments may change a repeated historical query; this is not an immutable reporting snapshot.

The result echoes normalized UTC bounds and application filter. `observedAt` is the database transaction timestamp and `consistency` is `repeatable-read`. All reads in one result use one PostgreSQL repeatable-read transaction. Separate requests are independent observations. Time precision is bounded to milliseconds so JavaScript date normalization cannot silently move a sub-millisecond boundary.

`invocations` counts total/RUNNING/SUCCEEDED/FAILED/UNKNOWN records. Each token dimension separately returns `known` (sum of non-null counters) and `unknownInvocations` (number of null counters). A known sum of `0` with an unknown count greater than zero is not a complete zero-usage claim. An empty cohort returns zero known sums and zero unknown counts. Decimal strings retain precision beyond JavaScript's safe integer range. Input/output counters are not added to a synthetic monetary charge.

## Ledger attribution

Ledger data is opt-in for exactly one `budgetAccountId`. `unit` comes from that budget account; it is an internal configured accounting unit, not necessarily a currency or a live vendor price. `attributedPostedUnits` sums append-only ledger deltas, including negative corrections, only when the referenced observation covers exactly one cohort invocation under the same execution and attempt. Ledger entry/evidence joins never multiply token counts, and entries from other budget scopes are never added together.

`excludedObservationCount` counts distinct posted observations for the selected budget account that reference a cohort invocation but cover multiple entries. Their units cannot safely be allocated to one invocation/connection and are excluded. Observations without any matching invocation reference, unposted/unknown evidence, held reservations, agent-only usage and vendor charges not ingested into this platform are outside this summary. Thus even zero exclusions is not a statement of complete account spend. Reporting does not create observations/entries, release holds, reconcile unknown evidence or call a provider.

## Query and migration bounds

Response shape has a fixed number of counters and at most one ledger account. Queries aggregate in PostgreSQL rather than loading raw invocation/evidence arrays into API memory. A transaction has a 1-second pool acquisition bound, 5-second transaction timeout and 3-second statement timeout. Failed/timed-out reads do not return partial totals or invented zeroes. These bounds are protective limits, not a production latency/SLO claim; high-volume reporting may require a separately measured projection.

Migration `0027_connection_usage_index` adds `(connection_id, started_at)` using `CREATE INDEX CONCURRENTLY`; it must run outside an explicit transaction. Normal migration deployment still applies. It does not reset or rewrite data. On an interrupted deployment, inspect migration status and the named index's `pg_index.indisvalid` before an operator repairs/resolves/retries; an invalid concurrently built index is not proof of completion. No production migration is performed by the local tests.

## Evidence and remaining work

Contract/unit tests cover authority before storage, strict windows/identifiers, exact decimal counters and explicit unknowns. The PostgreSQL M2 suite checks HTTP operator-only exposure and secret projection for two actual account mappings with replay, plus half-open boundaries, precision beyond `2^53`, null versus observed zero, multiple budget scopes, late corrections and mixed-coverage exclusion. Its owned disposable database is separate from user development stores and uses synthetic configuration.

The [account usage dashboard](ACCOUNT-USAGE-DASHBOARD.md) now consumes this API with explicit UTC filters, unknown counters, single-budget attribution, account/filter isolation and browser workflow evidence. Separately approved secret-manager/nonlocal identity/live-provider deployment proof, production load, vendor billing reconciliation, quota/health synchronization and the Agent Runtime proposal remain separate work.
