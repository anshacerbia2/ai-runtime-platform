# Documentation Index

**Baseline 0.2 + adopted extensions through ADR-0024.** Entry point: [README](../README.md). M0 Contract Lab remains runnable; M1 registry foundation is in progress while full AI execution remains planned. [ADR](adr/README.md) is the active architectural decision reference.

## Authority and traceability

ADRs record decisions and trade-offs; architecture explains the system; detailed contracts/data/reliability pages define operational semantics; diagrams visualize them; acceptance documents define future evidence. [RECONCILIATION](reviews/RECONCILIATION.md) maps baseline topics and clarifications to ADRs, specifications, and gates. Prior review history remains in Git, not a required source file for current navigation.

## Overview

| Document                                        | Purpose                                   |
| ----------------------------------------------- | ----------------------------------------- |
| [ARCHITECTURE.md](architecture/ARCHITECTURE.md) | AI Runtime Platform — Architecture        |
| [PLAN.md](PLAN.md)                              | AI Runtime Platform — Implementation Plan |
| [ROADMAP.md](ROADMAP.md)                        | AI Runtime Platform — Roadmap             |
| [CHANGELOG.md](CHANGELOG.md)                    | Changelog                                 |

## Architecture and vocabulary

| Document                                                      | Purpose                                      |
| ------------------------------------------------------------- | -------------------------------------------- |
| [docs/architecture/BOUNDARIES.md](architecture/BOUNDARIES.md) | Batas Produk, Actor, dan Kepemilikan         |
| [docs/architecture/FRONTEND.md](architecture/FRONTEND.md)     | ATI One internal app, CDD, dan design tokens |
| [docs/GLOSSARY.md](GLOSSARY.md)                               | Glossary — Canonical Vocabulary              |

## Contracts

| Document                                                                  | Purpose                                             |
| ------------------------------------------------------------------------- | --------------------------------------------------- |
| [docs/contracts/API.md](contracts/API.md)                                 | Application API Contract                            |
| [docs/contracts/CAPABILITIES.md](contracts/CAPABILITIES.md)               | Canonical Capability Catalogue                      |
| [docs/contracts/EXECUTION-LIFECYCLE.md](contracts/EXECUTION-LIFECYCLE.md) | Execution dan Attempt Lifecycle                     |
| [docs/contracts/EVENTS-STREAMING.md](contracts/EVENTS-STREAMING.md)       | Events, SSE, dan Stream Recovery                    |
| [docs/contracts/PROFILES-ADAPTERS.md](contracts/PROFILES-ADAPTERS.md)     | Execution Profiles dan Adapter Contracts            |
| [docs/contracts/TOOLS-PLUGINS.md](contracts/TOOLS-PLUGINS.md)             | Tools, Plugins, dan Stateful Operation Contract     |
| [docs/contracts/ARTIFACTS-SESSIONS.md](contracts/ARTIFACTS-SESSIONS.md)   | Artifact, Workspace, dan Session Contract           |
| [docs/contracts/CONTROL-PLANE.md](contracts/CONTROL-PLANE.md)             | Applications, AI Connections, Plugins, Runner Fleet |

## Data, reliability and security

| Document                                                                    | Purpose                                      |
| --------------------------------------------------------------------------- | -------------------------------------------- |
| [docs/data/ACCOUNTING.md](data/ACCOUNTING.md)                               | Usage, Budget, dan Financial Reconciliation  |
| [docs/reliability/OWNERSHIP-RECOVERY.md](reliability/OWNERSHIP-RECOVERY.md) | Ownership, Lease, Fencing, dan Recovery      |
| [docs/data/DATA-MODEL.md](data/DATA-MODEL.md)                               | Logical Data Model dan Persistence Contracts |
| [docs/security/SECURITY.md](security/SECURITY.md)                           | Security, Privacy, dan Threat Model          |

## Operations and migration

| Document                                                          | Purpose                                     |
| ----------------------------------------------------------------- | ------------------------------------------- |
| [docs/operations/DEPLOYMENT.md](operations/DEPLOYMENT.md)         | Deployment dan Operability Blueprint        |
| [docs/operations/SLO-CAPACITY.md](operations/SLO-CAPACITY.md)     | SLI, SLO, Capacity, dan Parameter Register  |
| [docs/operations/RUNBOOKS.md](operations/RUNBOOKS.md)             | Operational Runbooks                        |
| [docs/migration/APPLICATIONS.md](migration/APPLICATIONS.md)       | Application Adoption dan Migration Playbook |
| [docs/development/CONFIGURATION.md](development/CONFIGURATION.md) | Single Environment Configuration Gate       |

## Decisions and verification

| Document                                                        | Purpose                                                |
| --------------------------------------------------------------- | ------------------------------------------------------ |
| [docs/testing/ACCEPTANCE.md](testing/ACCEPTANCE.md)             | Acceptance, Conformance, dan Production Gate Catalogue |
| [docs/decisions/OPEN-QUESTIONS.md](decisions/OPEN-QUESTIONS.md) | Open Decisions dan Residual Risk Register              |
| [docs/reviews/RECONCILIATION.md](reviews/RECONCILIATION.md)     | ADR Traceability — Baseline 0.2                        |
| [docs/reviews/SOURCES.md](reviews/SOURCES.md)                   | Source dan Evidence Register                           |
| [docs/reviews/VALIDATION.md](reviews/VALIDATION.md)             | Documentation Validation Record                        |

## ADRs

| Document                            | Purpose                                                                 |
| ----------------------------------- | ----------------------------------------------------------------------- |
| [docs/adr/README.md](adr/README.md) | Architecture Decision Records — keputusan aktif dan spesifikasi terkait |

## Visual catalogue

| Document                                      | Purpose           |
| --------------------------------------------- | ----------------- |
| [docs/diagrams/README.md](diagrams/README.md) | Diagram Catalogue |

## Recommended reading

App integrators: Architecture -> API -> profile/tool/artifact contracts -> application migration. Frontend implementers: Frontend Architecture -> ADR-0023/0024 -> ATI One integration gates -> component/token quality gates. Platform implementers: Architecture -> ADRs -> lifecycle/recovery/accounting -> data/deployment -> gates. Security/accounting reviewers: relevant ADRs -> detailed controls -> acceptance and open decisions. Traceability and diagram catalogues provide topic-specific entry points.

## Status conventions

Adopted in documentation means a baseline design choice, not implementation proof. PLANNED and NOT RUN refer to future implementation. ADR review and implementation verification remain separate; open requirements retain owners and closure gates instead of fabricated production values. Repointing references does not close pending reviews or create new approval.

## Runnable milestones

- [Local M0 setup, ports, data and manual tests](development/M0.md)
- [M0 scope and verification evidence](milestones/M0.md)
- [M1 durable control-plane foundation](milestones/M1.md)
- [ADR-0015: milestone vertical slices](adr/0015-testable-milestone-slices.md)

## Platform control and distributed execution

- [ADR-0019 — Application Registry, AI Connections, Credential Binding](adr/0019-application-connections-credentials.md)
- [ADR-0020 — Plugin Registry & Execution Packaging](adr/0020-plugin-registry-execution-packaging.md)
- [ADR-0021 — Optional Workspace & Remote Tools](adr/0021-workspace-remote-tools.md)
- [ADR-0022 — Distributed Runner Fleet](adr/0022-distributed-runner-fleet.md)
- [Fleet and connection diagram](diagrams/09-control-plane-fleet.md)
