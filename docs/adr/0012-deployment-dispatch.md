# ADR-0012 — Modular control plane dan durable dispatch

**Tanggal:** 20 September 2026  
**Status:** adopted for documentation baseline 0.2; implementation NOT VERIFIED.  
**Dasar:** application boundary [ADR-0001](0001-application-ownership.md) dan durable data authority [ADR-0003](0003-tiered-storage.md). Review baseline tetap dilacak melalui O11.

## Context
Shared platform needs reliable delivery without building many microservices or a business workflow engine. Dual-write queue/state can lose work.

## Decision
Modular control plane plus separate agent workers; PG work/assignment/outbox authority; optional external broker as delivery optimization with idempotent consumer. Direct gateway pool not long-agent queue. Redis hot layer and object/secret stores isolated. Interactive/batch/agent capacity budgets separated.

## Alternatives considered

All functions as many microservices from day one ditolak. In-memory-only registry ditolak. Premature generic workflow engine ditolak. Single unbounded shared worker pool ditolak.

## Consequences and trade-offs

Dispatcher/SoR capacity must be measured. External broker can be added later without moving authority. Deployment topology/HA choices remain open until requirements and evidence exist.

## Verification

G09/G22/G23/G24; [DEPLOYMENT](../operations/DEPLOYMENT.md).

## Evolution / revisit trigger

Extract services/broker when isolation/scaling evidence justifies; preserve state/outbox/admission contracts.

Navigasi keputusan: [ADR index](README.md). Peta pendukung: [traceability](../reviews/RECONCILIATION.md). Decision gaps: [OPEN-QUESTIONS](../decisions/OPEN-QUESTIONS.md).
