# ADR-0009 — Bounded SSE replay dan durable control events

**Tanggal:** 20 September 2026  
**Status:** design adopted for baseline 0.2; current implementation coverage is stated below, not a blanket production verification.\
**Dasar:** pemisahan hot stream dan durable state [ADR-0003](0003-tiered-storage.md), dengan verification gate [ADR-0013](0013-evolution-gates.md). Review baseline tetap dilacak melalui O11.

## Implementation reconciliation — 24 September 2026

No SSE runtime route, codec, Last-Event-ID resume, heartbeat or subscriber backpressure implementation exists. The general Event payload schema is not a typed streaming decoder. See [current source state](../implementation/CURRENT-STATE.md), [active HTTP operations](../implementation/HTTP-API.md), and [verification scope](../reviews/CONTRACT-EXECUTION.md). This note updates implementation status only; it does not create new reviewer approval or erase the original decision history.

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

Navigasi keputusan: [ADR index](README.md). Peta pendukung: [traceability](../reviews/RECONCILIATION.md). Decision gaps: [OPEN-QUESTIONS](../decisions/OPEN-QUESTIONS.md).
