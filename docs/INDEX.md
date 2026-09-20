# Documentation Index

**Baseline 0.2 · 20 September 2026.** Entry point: [README](../README.md). Scope is documentation only, not a shipped runtime. [AUDIT.md](../AUDIT.md) remains the unchanged historical principal source.

## Authority and provenance

Architecture explains the system; detailed contracts/data/reliability pages define operational semantics; ADRs explain decisions/trade-offs; diagrams visualize them; acceptance documents define future evidence. Amendments versus principal are explicit in [RECONCILIATION](reviews/RECONCILIATION.md). No historical sign-off is silently rewritten.

## Overview

| Document | Purpose |
| --- | --- |
| [ARCHITECTURE.md](../ARCHITECTURE.md) | AI Runtime Platform — Architecture |
| [PLAN.md](../PLAN.md) | AI Runtime Platform — Implementation Plan |
| [ROADMAP.md](../ROADMAP.md) | AI Runtime Platform — Roadmap |
| [CHANGELOG.md](../CHANGELOG.md) | Changelog |

## Architecture and vocabulary

| Document | Purpose |
| --- | --- |
| [docs/architecture/BOUNDARIES.md](architecture/BOUNDARIES.md) | Batas Produk, Actor, dan Kepemilikan |
| [docs/GLOSSARY.md](GLOSSARY.md) | Glossary — Canonical Vocabulary |

## Contracts

| Document | Purpose |
| --- | --- |
| [docs/contracts/API.md](contracts/API.md) | Application API Contract |
| [docs/contracts/EXECUTION-LIFECYCLE.md](contracts/EXECUTION-LIFECYCLE.md) | Execution dan Attempt Lifecycle |
| [docs/contracts/EVENTS-STREAMING.md](contracts/EVENTS-STREAMING.md) | Events, SSE, dan Stream Recovery |
| [docs/contracts/PROFILES-ADAPTERS.md](contracts/PROFILES-ADAPTERS.md) | Execution Profiles dan Adapter Contracts |
| [docs/contracts/TOOLS-PLUGINS.md](contracts/TOOLS-PLUGINS.md) | Tools, Plugins, dan Stateful Operation Contract |
| [docs/contracts/ARTIFACTS-SESSIONS.md](contracts/ARTIFACTS-SESSIONS.md) | Artifact, Workspace, dan Session Contract |

## Data, reliability and security

| Document | Purpose |
| --- | --- |
| [docs/data/ACCOUNTING.md](data/ACCOUNTING.md) | Usage, Budget, dan Financial Reconciliation |
| [docs/reliability/OWNERSHIP-RECOVERY.md](reliability/OWNERSHIP-RECOVERY.md) | Ownership, Lease, Fencing, dan Recovery |
| [docs/data/DATA-MODEL.md](data/DATA-MODEL.md) | Logical Data Model dan Persistence Contracts |
| [docs/security/SECURITY.md](security/SECURITY.md) | Security, Privacy, dan Threat Model |

## Operations and migration

| Document | Purpose |
| --- | --- |
| [docs/operations/DEPLOYMENT.md](operations/DEPLOYMENT.md) | Deployment dan Operability Blueprint |
| [docs/operations/SLO-CAPACITY.md](operations/SLO-CAPACITY.md) | SLI, SLO, Capacity, dan Parameter Register |
| [docs/operations/RUNBOOKS.md](operations/RUNBOOKS.md) | Operational Runbooks |
| [docs/migration/APPLICATIONS.md](migration/APPLICATIONS.md) | Application Adoption dan Migration Playbook |

## Decisions and verification

| Document | Purpose |
| --- | --- |
| [docs/testing/ACCEPTANCE.md](testing/ACCEPTANCE.md) | Acceptance, Conformance, dan Production Gate Catalogue |
| [docs/decisions/OPEN-QUESTIONS.md](decisions/OPEN-QUESTIONS.md) | Open Decisions dan Residual Risk Register |
| [docs/reviews/RECONCILIATION.md](reviews/RECONCILIATION.md) | Reconciliation — Principal Sign-Off dan Baseline 0.2 |
| [docs/reviews/SOURCES.md](reviews/SOURCES.md) | Source dan Evidence Register |
| [docs/reviews/VALIDATION.md](reviews/VALIDATION.md) | Documentation Validation Record |

## ADRs

| Document | Purpose |
| --- | --- |
| [docs/adr/README.md](adr/README.md) | Architecture Decision Records |

## Visual catalogue

| Document | Purpose |
| --- | --- |
| [docs/diagrams/README.md](diagrams/README.md) | Diagram Catalogue |

## Recommended reading

App integrators: Architecture -> API -> profile/tool/artifact contracts -> application migration. Platform implementers: Architecture -> ADRs -> lifecycle/recovery/accounting -> data/deployment -> gates. Security/accounting reviewers: reconciliation -> relevant ADRs -> detailed controls -> acceptance and open decisions. Diagram catalogue provides flow-specific entry points.

## Status conventions

Adopted in documentation means a baseline design choice, not implementation proof. PLANNED and NOT RUN refer to future implementation. Source claims remain attributed to their source; authored corrections are marked as amendments. Open requirements are listed with owners and closure gates instead of fabricated production values.
