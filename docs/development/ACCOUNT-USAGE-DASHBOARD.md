# Account usage dashboard

Checkpoint: 29 October 2026 (Asia/Jakarta). The Control Plane console now reads the [per-connection usage API](CONNECTION-USAGE.md) through the existing session BFF. It follows [frontend architecture](../architecture/FRONTEND.md) and [ADR-0024](../adr/0024-component-driven-ui-tokens.md); no backend route, settlement rule, schema migration or architecture decision is added.

## Operator flow

Open **Control Plane → Connections**, then **View usage** for a registered account. The existing connection collection remains paginated. The **Account usage** tab opens the selected account; with no selection it offers a link back to Connections. Account name/provider/configuration state come from registry metadata. ENABLED/DISABLED describes configuration, not a provider health probe.

The initial period is the last 24 hours in UTC, captured when opening the account. Start and exclusive end use explicit UTC date/time inputs; periods must be positive and at most 31 days. Application and budget selectors load independent bounded registry pages and retain a selected item while navigating option pages. Changes are drafts until **Apply usage filters**. **Set last 24 hours** changes the draft period; **Refresh usage** repeats the already applied period. There is no automatic polling, traversal of all registry pages or per-account fanout.

The result shows provider invocation counts, exact known input/output token sums, per-dimension unavailable counts, unresolved outcomes, and the database observation timestamp. Decimal strings are formatted without converting them to JavaScript numbers. Unknown measurements remain visible beside known sums, including when a sum is zero. An empty cohort says that the platform has no matching records; it does not claim zero upstream spend.

Ledger display requires one explicitly selected budget account. Units come from that account and are never assumed to be a currency. Posted corrections and excluded mixed-coverage observations remain visible. Holds, unmatched/unposted evidence and unknown vendor charges are not presented as a complete bill or balance. Full attribution and time semantics remain defined by the API guide.

## Request and failure behavior

The client calls the shared inferred route with same-origin credentials; provider keys and service tokens never enter this feature. A successful payload must match the requested connection, period, application and optional ledger account before it can be shown. Each applied account/filter tuple owns a separate query lifecycle; changing it unmounts and aborts the previous read. Late responses cannot replace another account's result. Switching accounts also resets the draft filters.

Refresh failure for the same tuple preserves an explicitly marked **Last successful result**, with the original observation time and an actual retry button. A new tuple starts with loading/error rather than carrying the previous tuple's totals. A picker failure is independent of the usage read; it never converts unknown/unavailable data into zeroes or a fabricated balance. Existing bounded transport, cancellation and no-store rules remain in force; no cross-session cache or new query library is introduced.

## Components and verification

The feature reuses Panel, MetricCard, Badge, DataTable, Button and the keyboard-accessible Select. Generic PanelBody supplies consistent token-based content padding. The small outcome table opts into fitting the available width; wide registry tables keep their existing scrolling behavior. The mobile shell now clears its rail width for both collapsed and expanded off-canvas states, fixing a specificity issue exposed during screenshot inspection. Desktop/mobile browser tests check actual content bounds and the outcome table, not only document scroll width.

Pure/client tests cover UTC/calendar/range validation, exact integer formatting and mismatched response scope. Three browser cases use explicit synthetic HTTP responses to exercise paging/pinned selection, apply versus draft state, unknowns/corrections, validation, independent errors, stale data, account switching and late responses. A separate case creates a uniquely owned connection through the real BFF/API and reads its empty durable usage through the rendered UI without route mocks or provider dispatch. It removes only the successfully created fixture and its own receipt/audit/outbox metadata.

Local browser verification uses an isolated checkout and synthetic environment; the real-path case uses a verified owned disposable PostgreSQL cluster and API. It does not read user `.env` or alter the user development database. Screenshots supplement behavior tests. These are fixture/conformance results, not live vendor billing, nonlocal identity or production deployment approval. Secret-manager integration, authorized live-provider smoke, vendor quota/balance/health synchronization and production SLO evidence remain open.
