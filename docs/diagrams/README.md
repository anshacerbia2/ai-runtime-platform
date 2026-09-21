# Diagram Catalogue

**Baseline 0.2.** 23 numbered Mermaid diagrams plus one architecture overview. These are authored target views, not screenshots of a running deployment. Canonical textual contracts define preconditions and failure semantics when a diagram omits detail.

| Diagram | View and flow                                      | Source                                                           |
| ------- | -------------------------------------------------- | ---------------------------------------------------------------- |
| D01     | System context                                     | [01-system-context.md](01-system-context.md)                     |
| D02     | Logical container view                             | [01-system-context.md](01-system-context.md)                     |
| D03     | Control-plane component flow                       | [01-system-context.md](01-system-context.md)                     |
| D04     | Direct streaming chat                              | [02-direct-inference.md](02-direct-inference.md)                 |
| D05     | Structured output routing dan validation           | [02-direct-inference.md](02-direct-inference.md)                 |
| D06     | Agent happy path                                   | [03-agent-execution.md](03-agent-execution.md)                   |
| D07     | Scribe v2 ownership flow                           | [03-agent-execution.md](03-agent-execution.md)                   |
| D08     | Profile dan package publication                    | [03-agent-execution.md](03-agent-execution.md)                   |
| D09     | Public execution lifecycle                         | [04-recovery-cancellation.md](04-recovery-cancellation.md)       |
| D10     | Conditional lease renewal                          | [04-recovery-cancellation.md](04-recovery-cancellation.md)       |
| D11     | Orphan quarantine dan safe retry                   | [04-recovery-cancellation.md](04-recovery-cancellation.md)       |
| D12     | Cancel versus complete                             | [04-recovery-cancellation.md](04-recovery-cancellation.md)       |
| D13     | Atomic admission tanpa mutasi pada denial          | [05-budget-accounting.md](05-budget-accounting.md)               |
| D14     | Settlement atomic dan projection idempotent        | [05-budget-accounting.md](05-budget-accounting.md)               |
| D15     | Late usage dan adjustment setelah fast-path window | [05-budget-accounting.md](05-budget-accounting.md)               |
| D16     | SSE reconnect dan explicit resync                  | [06-streaming-artifacts.md](06-streaming-artifacts.md)           |
| D17     | Artifact candidate versus official result          | [06-streaming-artifacts.md](06-streaming-artifacts.md)           |
| D18     | Scoped single-writer runtime session               | [06-streaming-artifacts.md](06-streaming-artifacts.md)           |
| D19     | Initial deployment topology                        | [07-deployment-data-security.md](07-deployment-data-security.md) |
| D20     | Logical entity relationships                       | [07-deployment-data-security.md](07-deployment-data-security.md) |
| D21     | Trust and permission boundaries                    | [07-deployment-data-security.md](07-deployment-data-security.md) |
| D22     | Dependency and readiness flow                      | [08-evolution-migration.md](08-evolution-migration.md)           |
| D23     | Per-application migration and rollback             | [08-evolution-migration.md](08-evolution-migration.md)           |

## Reading paths

Start with D01–D03 for boundary/components. Direct-chat consumers read D04–D05 and D16. Scribe/agent integration reads D06–D12, D17–D18. Accounting reviewers read D13–D15 plus the [accounting contract](../data/ACCOUNTING.md). Operators read D19–D21 and the [runbooks](../operations/RUNBOOKS.md). Delivery planning uses D22–D23.

## Rendering and maintenance

Mermaid fences are the editable source and can be viewed in compatible Markdown renderers, including repository viewers supporting Mermaid. Generated renderings are validation artifacts, not a separate source of truth. Do not change an arrow to imply app-to-database access, unfenced worker writes, automatic unsafe retry, or financial truth derived only from cache.

On change, update related canonical contract, ADR, test IDs and this catalogue. Actual parse/render checks and limitations are reported in [VALIDATION](../reviews/VALIDATION.md). All implementation gates remain separate.

## Control plane and fleet

[09-control-plane-fleet.md](09-control-plane-fleet.md) shows Application Registry, AI Connections/credential bindings, Plugin Registry, runner pools, central versus runner-local credential locality, and placement across multiple servers.
