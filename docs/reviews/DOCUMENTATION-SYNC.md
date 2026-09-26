# Source-first Documentation Synchronization

**24 September 2026 (Asia/Jakarta).** Scope: README and every Markdown document under docs/. Documentation follows the actual code for implemented behavior; target architecture and historical decisions remain explicitly separated. This is not a new production approval.

## Inventory and method

The initial inventory contained 80 Markdown files. All were reviewed and updated, and four documents were added: current state, exhaustive active HTTP reference, implemented diagrams and this synchronization record. The source inspection used registered contracts, API/application/infrastructure code, physical schema/migrations, browser/BFF/hooks, configuration, tests and the last completed evidence. Code and migration behavior were not changed to match prose.

Before editing, documents were copied to .local/docs-sync-20260924-1907/ and 281 non-document files were hashed. The edit helper was restricted to README.md and docs/*.md. Formatter invocation is scoped to Markdown. Generated OpenAPI, Prisma migration SQL, dependencies and user sign-in/layout edits are outside the write scope. No staging, commit or push is part of this task.

## Main reconciliations

| Area                  | Documentation now reflects                                                                                                                    |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Stack and source tree | Next.js/BFF rather than current Vite; control-plane resources/receipts/runner modules and six migrations                                      |
| HTTP surface          | All 46 registered method/path operations, 38 browser-exposed pairs, real success/error semantics and explicit planned /v1 distinction         |
| Idempotency/retry     | Receipt plus revision semantics, seven-day retained-key policy, up to three operation-owned client attempts and one BFF attempt               |
| Data and states       | 26 Prisma models with physical table names; actual OWNED/RESULT_PROPOSED vocabulary is not conflated with target ACTIVE/COMPLETED             |
| Query/UI              | Independent keyset pages and count-only overview; no full CRUD/approval editor or unknown-as-success claims                                   |
| Runner                | Exact manual authority/fencing/quarantine exists; autonomous dispatch, Redis heartbeat/epoch coordinator and real model execution do not      |
| Serialization         | Explicit shape mappers, finite bounded JSON and AST gate; no claim of zero-allocation or production p99                                       |
| OpenAPI/CDC           | Provider/browser security and response headers; eleven current Pact interactions per hop plus frozen baseline, not exhaustive SDK conformance |
| Future features       | SSE/Event payload semantics, plugins/MCP, runtime sessions, objects/sandbox, provider integrations and production gates remain planned/open   |
| History               | Old test counts, superseded hosting/stack and one-attempt ADR remain dated history, not current global status                                 |

## Source changes observed during this task

The previous verified implementation digest was 03a22e6966aaf02eb76d9bad4887c5ff7d20698579d963c98b2cea870952f4a2 (273 source/test/config files). At task start, use-workspace.ts already differed by local debug output. During documentation editing, use-workspace.ts and use-resource-query.ts changed again outside this docs-only edit scope. Their current contents were read back: catalogue orchestration remains separate, and useResourceQuery now keeps the loader in a ref with separate mount/load effects. No attempt was made to overwrite or restore those changes.

Because of those differences, prior runtime PASS results remain attached to their original digest. Fresh checks are recorded below independently. The final non-doc hash comparison must distinguish externally observed edits from documentation writes, rather than claiming all files were byte-identical throughout.

## Verification

Completed checks for this documentation task are listed below. Original failures and later successes are retained separately; rerunning a check does not erase its first result.

| Check                                     | Observed result                                                                                                                                        | Evidence                                                                |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| Documentation inventory                   | 80 existing files reviewed/updated, four new files; 84 total                                                                                           | Coverage ledger below; .local/docs-sync-document-inventory.json         |
| Links and Markdown                        | 84 Markdown files and 1,039 local links checked with no missing file targets before final evidence append                                              | scripts/check-docs.mjs; final readback repeats this check               |
| Active route catalogue                    | All 46 operation keys/methods/paths match apiContract; 38 BFF pairs                                                                                    | .local/docs-sync-structure.json                                         |
| Physical data catalogue                   | All 26 Prisma model/table pairs represented                                                                                                            | .local/docs-sync-structure.json                                         |
| Fenced examples                           | Eight JSON examples parse; 30 Mermaid blocks have balanced fences                                                                                      | .local/docs-sync-structure.json; Mermaid syntax/render was not executed |
| Built-in server Markdown reader           | All 83 documents under docs/ render through the real sanitizer/catalogue; README is outside that root                                                  | .local/docs-sync-reader.log; exit 0                                     |
| Initial full verify                       | FAIL: 39 of 40 integration cases passed; initial resource creation in the lost-acknowledgement test returned 503 instead of 200                        | .local/docs-sync-verify.log; exit 1                                     |
| Isolated receipt recheck                  | PASS, one targeted integration case; no code or test assertion changed                                                                                 | .local/docs-sync-receipt-recheck.log; exit 0                            |
| Full verify rerun                         | PASS: 30 contract, 19 API unit, 27 tooling, 40 integration and 58 web/BFF cases; current/frozen Pact, production build and boundary checks also passed | .local/docs-sync-verify-rerun.log; exit 0                               |
| Fresh-server E2E attempt                  | Startup blocked by an already-running Next dev server for this same workspace; no existing process was killed                                          | .local/docs-sync-e2e.log; not a passed browser run                      |
| Browser suite against existing dev server | 20 PASS, 1 FAIL: playground history reload exceeded the 30-second test deadline                                                                        | .local/docs-sync-e2e-existing.log; exit 1                               |

The receipt failure's root cause was not established by this docs-only task. The subsequent isolated and full-suite passes are evidence of those runs, not proof the intermittent failure has been fixed. Likewise, the History reload timeout was not repaired or waived. It remains an open verification finding, distinct from successful documentation rendering and link checks. Earlier 21/21 E2E closure evidence elsewhere in the repository is historical and does not replace this current 20/21 result.

Rerun source snapshot (281 protected non-document files) was recorded in .local/docs-sync-rerun-source.json, aggregate SHA-256 4ede30def79195f44730077227cd205fc0dbc732abf44675d14cddbea34f3812. No protected source changes were observed between that capture and the final test readback. Across the entire task, only the two externally changed frontend files noted above differed from the initial non-document hashes; this task did not edit them. Final formatting/link/hash checks are recorded in .local/docs-sync-final-checks.log and .local/docs-sync-final-evidence.json.

## Coverage ledger

The table covers all 84 resulting Markdown files. New as-built views supplement, rather than silently replacing, planned architecture requirements.

| Document                                                                                                   | Review action        | Coverage                         |
| ---------------------------------------------------------------------------------------------------------- | -------------------- | -------------------------------- |
| [README.md](../../README.md)                                                                               | Reviewed and updated | Entry point                      |
| [docs/CHANGELOG.md](../CHANGELOG.md)                                                                       | Reviewed and updated | Navigation/plan/vocabulary       |
| [docs/GLOSSARY.md](../GLOSSARY.md)                                                                         | Reviewed and updated | Navigation/plan/vocabulary       |
| [docs/INDEX.md](../INDEX.md)                                                                               | Reviewed and updated | Navigation/plan/vocabulary       |
| [docs/PLAN.md](../PLAN.md)                                                                                 | Reviewed and updated | Navigation/plan/vocabulary       |
| [docs/ROADMAP.md](../ROADMAP.md)                                                                           | Reviewed and updated | Navigation/plan/vocabulary       |
| [docs/adr/0001-application-ownership.md](../adr/0001-application-ownership.md)                             | Reviewed and updated | ADR status/history               |
| [docs/adr/0002-managed-envelope.md](../adr/0002-managed-envelope.md)                                       | Reviewed and updated | ADR status/history               |
| [docs/adr/0003-tiered-storage.md](../adr/0003-tiered-storage.md)                                           | Reviewed and updated | ADR status/history               |
| [docs/adr/0004-routing-dual-adapter.md](../adr/0004-routing-dual-adapter.md)                               | Reviewed and updated | ADR status/history               |
| [docs/adr/0005-leases-fencing.md](../adr/0005-leases-fencing.md)                                           | Reviewed and updated | ADR status/history               |
| [docs/adr/0006-orthogonal-state.md](../adr/0006-orthogonal-state.md)                                       | Reviewed and updated | ADR status/history               |
| [docs/adr/0007-durable-accounting.md](../adr/0007-durable-accounting.md)                                   | Reviewed and updated | ADR status/history               |
| [docs/adr/0008-late-usage.md](../adr/0008-late-usage.md)                                                   | Reviewed and updated | ADR status/history               |
| [docs/adr/0009-stream-replay.md](../adr/0009-stream-replay.md)                                             | Reviewed and updated | ADR status/history               |
| [docs/adr/0010-tool-side-effects.md](../adr/0010-tool-side-effects.md)                                     | Reviewed and updated | ADR status/history               |
| [docs/adr/0011-sandbox-security.md](../adr/0011-sandbox-security.md)                                       | Reviewed and updated | ADR status/history               |
| [docs/adr/0012-deployment-dispatch.md](../adr/0012-deployment-dispatch.md)                                 | Reviewed and updated | ADR status/history               |
| [docs/adr/0013-evolution-gates.md](../adr/0013-evolution-gates.md)                                         | Reviewed and updated | ADR status/history               |
| [docs/adr/0014-artifacts-sessions.md](../adr/0014-artifacts-sessions.md)                                   | Reviewed and updated | ADR status/history               |
| [docs/adr/0015-testable-milestone-slices.md](../adr/0015-testable-milestone-slices.md)                     | Reviewed and updated | ADR status/history               |
| [docs/adr/0016-nestjs-fastify.md](../adr/0016-nestjs-fastify.md)                                           | Reviewed and updated | ADR status/history               |
| [docs/adr/0017-prisma-postgresql.md](../adr/0017-prisma-postgresql.md)                                     | Reviewed and updated | ADR status/history               |
| [docs/adr/0018-clean-architecture-quality.md](../adr/0018-clean-architecture-quality.md)                   | Reviewed and updated | ADR status/history               |
| [docs/adr/0019-application-connections-credentials.md](../adr/0019-application-connections-credentials.md) | Reviewed and updated | ADR status/history               |
| [docs/adr/0020-plugin-registry-execution-packaging.md](../adr/0020-plugin-registry-execution-packaging.md) | Reviewed and updated | ADR status/history               |
| [docs/adr/0021-workspace-remote-tools.md](../adr/0021-workspace-remote-tools.md)                           | Reviewed and updated | ADR status/history               |
| [docs/adr/0022-distributed-runner-fleet.md](../adr/0022-distributed-runner-fleet.md)                       | Reviewed and updated | ADR status/history               |
| [docs/adr/0023-ati-one-internal-app.md](../adr/0023-ati-one-internal-app.md)                               | Reviewed and updated | ADR status/history               |
| [docs/adr/0024-component-driven-ui-tokens.md](../adr/0024-component-driven-ui-tokens.md)                   | Reviewed and updated | ADR status/history               |
| [docs/adr/0025-external-app-standalone-auth.md](../adr/0025-external-app-standalone-auth.md)               | Reviewed and updated | ADR status/history               |
| [docs/adr/0026-nextjs-bff.md](../adr/0026-nextjs-bff.md)                                                   | Reviewed and updated | ADR status/history               |
| [docs/adr/0027-shared-rest-consumer-contracts.md](../adr/0027-shared-rest-consumer-contracts.md)           | Reviewed and updated | ADR status/history               |
| [docs/adr/0028-http-behavior-and-outcome-semantics.md](../adr/0028-http-behavior-and-outcome-semantics.md) | Reviewed and updated | ADR status/history               |
| [docs/adr/0029-replay-resources-runner-authority.md](../adr/0029-replay-resources-runner-authority.md)     | Reviewed and updated | ADR status/history               |
| [docs/adr/README.md](../adr/README.md)                                                                     | Reviewed and updated | ADR status/history               |
| [docs/architecture/ARCHITECTURE.md](../architecture/ARCHITECTURE.md)                                       | Reviewed and updated | Architecture/source map          |
| [docs/architecture/BOUNDARIES.md](../architecture/BOUNDARIES.md)                                           | Reviewed and updated | Architecture/source map          |
| [docs/architecture/CODE-STRUCTURE.md](../architecture/CODE-STRUCTURE.md)                                   | Reviewed and updated | Architecture/source map          |
| [docs/architecture/FRONTEND.md](../architecture/FRONTEND.md)                                               | Reviewed and updated | Architecture/source map          |
| [docs/contracts/API.md](../contracts/API.md)                                                               | Reviewed and updated | Contract/current-target boundary |
| [docs/contracts/ARTIFACTS-SESSIONS.md](../contracts/ARTIFACTS-SESSIONS.md)                                 | Reviewed and updated | Contract/current-target boundary |
| [docs/contracts/CAPABILITIES.md](../contracts/CAPABILITIES.md)                                             | Reviewed and updated | Contract/current-target boundary |
| [docs/contracts/CONTROL-PLANE.md](../contracts/CONTROL-PLANE.md)                                           | Reviewed and updated | Contract/current-target boundary |
| [docs/contracts/EVENTS-STREAMING.md](../contracts/EVENTS-STREAMING.md)                                     | Reviewed and updated | Contract/current-target boundary |
| [docs/contracts/EXECUTION-LIFECYCLE.md](../contracts/EXECUTION-LIFECYCLE.md)                               | Reviewed and updated | Contract/current-target boundary |
| [docs/contracts/PROFILES-ADAPTERS.md](../contracts/PROFILES-ADAPTERS.md)                                   | Reviewed and updated | Contract/current-target boundary |
| [docs/contracts/TOOLS-PLUGINS.md](../contracts/TOOLS-PLUGINS.md)                                           | Reviewed and updated | Contract/current-target boundary |
| [docs/data/ACCOUNTING.md](../data/ACCOUNTING.md)                                                           | Reviewed and updated | Physical/target data             |
| [docs/data/DATA-MODEL.md](../data/DATA-MODEL.md)                                                           | Reviewed and updated | Physical/target data             |
| [docs/decisions/OPEN-QUESTIONS.md](../decisions/OPEN-QUESTIONS.md)                                         | Reviewed and updated | Open decisions                   |
| [docs/development/CONFIGURATION.md](../development/CONFIGURATION.md)                                       | Reviewed and updated | Development/configuration        |
| [docs/development/CONTRACTS.md](../development/CONTRACTS.md)                                               | Reviewed and updated | Development/configuration        |
| [docs/development/M0.md](../development/M0.md)                                                             | Reviewed and updated | Development/configuration        |
| [docs/development/WEB.md](../development/WEB.md)                                                           | Reviewed and updated | Development/configuration        |
| [docs/diagrams/01-system-context.md](../diagrams/01-system-context.md)                                     | Reviewed and updated | Target/implemented diagrams      |
| [docs/diagrams/02-direct-inference.md](../diagrams/02-direct-inference.md)                                 | Reviewed and updated | Target/implemented diagrams      |
| [docs/diagrams/03-agent-execution.md](../diagrams/03-agent-execution.md)                                   | Reviewed and updated | Target/implemented diagrams      |
| [docs/diagrams/04-recovery-cancellation.md](../diagrams/04-recovery-cancellation.md)                       | Reviewed and updated | Target/implemented diagrams      |
| [docs/diagrams/05-budget-accounting.md](../diagrams/05-budget-accounting.md)                               | Reviewed and updated | Target/implemented diagrams      |
| [docs/diagrams/06-streaming-artifacts.md](../diagrams/06-streaming-artifacts.md)                           | Reviewed and updated | Target/implemented diagrams      |
| [docs/diagrams/07-deployment-data-security.md](../diagrams/07-deployment-data-security.md)                 | Reviewed and updated | Target/implemented diagrams      |
| [docs/diagrams/08-evolution-migration.md](../diagrams/08-evolution-migration.md)                           | Reviewed and updated | Target/implemented diagrams      |
| [docs/diagrams/09-control-plane-fleet.md](../diagrams/09-control-plane-fleet.md)                           | Reviewed and updated | Target/implemented diagrams      |
| [docs/diagrams/10-implemented-contracts.md](../diagrams/10-implemented-contracts.md)                       | New                  | Target/implemented diagrams      |
| [docs/diagrams/README.md](../diagrams/README.md)                                                           | Reviewed and updated | Target/implemented diagrams      |
| [docs/implementation/CURRENT-STATE.md](../implementation/CURRENT-STATE.md)                                 | New                  | As-built reference               |
| [docs/implementation/HTTP-API.md](../implementation/HTTP-API.md)                                           | New                  | As-built reference               |
| [docs/migration/APPLICATIONS.md](../migration/APPLICATIONS.md)                                             | Reviewed and updated | Migration scope                  |
| [docs/milestones/M0.md](../milestones/M0.md)                                                               | Reviewed and updated | Milestone/evidence               |
| [docs/milestones/M1.md](../milestones/M1.md)                                                               | Reviewed and updated | Milestone/evidence               |
| [docs/operations/DEPLOYMENT.md](../operations/DEPLOYMENT.md)                                               | Reviewed and updated | Operations/limits                |
| [docs/operations/RUNBOOKS.md](../operations/RUNBOOKS.md)                                                   | Reviewed and updated | Operations/limits                |
| [docs/operations/SLO-CAPACITY.md](../operations/SLO-CAPACITY.md)                                           | Reviewed and updated | Operations/limits                |
| [docs/reliability/OWNERSHIP-RECOVERY.md](../reliability/OWNERSHIP-RECOVERY.md)                             | Reviewed and updated | Navigation/plan/vocabulary       |
| [docs/reviews/CONTRACT-EXECUTION.md](CONTRACT-EXECUTION.md)                                                | Reviewed and updated | Evidence/traceability            |
| [docs/reviews/DOCUMENTATION-SYNC.md](DOCUMENTATION-SYNC.md)                                                | New                  | Evidence/traceability            |
| [docs/reviews/HTTP-CONTRACT-AUDIT.md](HTTP-CONTRACT-AUDIT.md)                                              | Reviewed and updated | Evidence/traceability            |
| [docs/reviews/RECONCILIATION.md](RECONCILIATION.md)                                                        | Reviewed and updated | Evidence/traceability            |
| [docs/reviews/REQUEST-CLOSURE.md](REQUEST-CLOSURE.md)                                                      | Reviewed and updated | Evidence/traceability            |
| [docs/reviews/SOURCES.md](SOURCES.md)                                                                      | Reviewed and updated | Evidence/traceability            |
| [docs/reviews/VALIDATION.md](VALIDATION.md)                                                                | Reviewed and updated | Evidence/traceability            |
| [docs/security/SECURITY.md](../security/SECURITY.md)                                                       | Reviewed and updated | Security boundary                |
| [docs/testing/ACCEPTANCE.md](../testing/ACCEPTANCE.md)                                                     | Reviewed and updated | Coverage/acceptance              |

## Limits

Documentation synchronization cannot certify a production deployment or complete an unimplemented subsystem. Broken-link checks are not security tests; Mermaid fences in the built-in web reader render as code. No live issuer/provider, external runner fleet, paid call, production migration, secret rotation or remote deployment was performed for this documentation task. Existing historical evidence is retained; code-relative links are intended for repository readers and are not arbitrary file downloads through the console.
