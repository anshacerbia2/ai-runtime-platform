# Changelog

## 0.2 — 20 September 2026 — Documentation reconciliation and expansion

Updated ARCHITECTURE, PLAN, and ROADMAP to cover agnostic direct/agent execution, app-owned workflow, Managed Execution Envelope, tiered storage, durable budget authority, worker fencing/recovery, and the pre-production Phase 3.5 gate.

Added detailed API/lifecycle/event/profile/tool/artifact/session contracts; data/accounting model; reliability/security/deployment/SLO/runbooks; migration playbook; 14 decision records; 23 numbered Mermaid diagrams plus the architecture overview; acceptance scenarios; glossary; open decisions; source and reconciliation registers; documentation validation record.

Operational amendments are explicit: completion independent of settlement, rejection-safe durable reservation, atomic settlement/outbox, conditional lease renewal, quarantine/verified late-charge adjustment, multi-turn envelope, stable tool operation keys, and measured gate parameters. Existing AUDIT.md remains unchanged as principal source, not retroactively edited approval.

This release changes documentation only. No application code, runtime adapter, database migration, service deployment, or production test is included. Actual local write/link/diagram checks are recorded in [VALIDATION](docs/reviews/VALIDATION.md), not asserted as runtime readiness.

## 0.1 — Initial documentation

Initial ARCHITECTURE.md, PLAN.md, and ROADMAP.md were committed as `376d435bf43589784b1f1a5d76f88be33b233365`. They established app-owned workflow and shared gateway/runtime/audit direction. Revision 0.2 expands and corrects the operational contracts; it does not erase the earlier Git history.
