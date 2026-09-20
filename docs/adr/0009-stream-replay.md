# ADR-0009 — Bounded SSE replay dan durable control events

**Tanggal:** 20 September 2026  
**Status:** adopted for documentation baseline 0.2; implementation NOT VERIFIED.  
**Dasar:** P02/P06; elaborasi bounded replay. Amendments terhadap principal tetap membutuhkan disposition O11; ini bukan signature baru principal.

## Context

SSE reconnect harus tidak mengulang inference. Hot history mempunyai retention/byte limits dan tidak boleh disamakan dengan durable result.

## Decision

Use opaque scoped cursor with attempt/epoch/sequence, bounded Redis replay, durable control events/outbox, and authoritative snapshot. 10m candidate age window plus byte caps. Expired cursor gives 410/reset; no fake prefix and no new attempt. Slow clients cannot grow unbounded queues.

## Alternatives considered

Unbounded token log PG path ditolak. Fire-and-forget stream tanpa gap signal ditolak. Infinite replay guarantee ditolak.

## Consequences and trade-offs

Client SDK/BFF perlu resume/reset logic dan dedup. Hot state loss affects presentation, not committed outcome. Archive raw transcript only by policy.

## Verification

G10/G11/G23; [EVENTS-STREAMING](../contracts/EVENTS-STREAMING.md).

## Evolution / revisit trigger

Change transport (e.g. bidirectional) only for real need; preserve event/cursor and failure semantics.

Provenance: [reconciliation register](../reviews/RECONCILIATION.md). Decision gaps: [OPEN-QUESTIONS](../decisions/OPEN-QUESTIONS.md).
