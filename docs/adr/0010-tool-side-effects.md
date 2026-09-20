# ADR-0010 — Receiver-supported idempotency untuk mutating tools

**Tanggal:** 20 September 2026  
**Status:** adopted for documentation baseline 0.2; implementation NOT VERIFIED.  
**Dasar:** P07; M10. Amendments terhadap principal tetap membutuhkan disposition O11; ini bukan signature baru principal.

## Context

Sandbox stop tidak membuktikan remote action batal. Per-attempt new key memungkinkan duplicate business mutation.

## Decision

Persist logical operation identity/input digest before invoke; same operation reuses stable key across attempts. Receiver implements dedup/status with adequate retention; UNKNOWN not no-effect. Mutating tools without this contract not allowed in autonomous retry profile. Domain publish/compensation normally stays app-owned. MCP only protocol adapter.

## Alternatives considered

Wrapper menambah key tanpa receiver semantics ditolak. Automatic mutation retry after SIGKILL ditolak. Model-self-approved privilege escalation ditolak.

## Consequences and trade-offs

Legacy tools perlu wrapper plus receiver guarantee atau dipindah ke app path. App must provide logical identity for cross-execution business retry. Not all plugins eligible initially.

## Verification

G13/G14/G18; [TOOLS-PLUGINS](../contracts/TOOLS-PLUGINS.md).

## Evolution / revisit trigger

New tool needs intent/receipt/idempotency/security tests; exactly-once label cannot replace evidence.

Provenance: [reconciliation register](../reviews/RECONCILIATION.md). Decision gaps: [OPEN-QUESTIONS](../decisions/OPEN-QUESTIONS.md).
