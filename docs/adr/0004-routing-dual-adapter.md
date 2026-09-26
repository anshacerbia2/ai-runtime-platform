# ADR-0004 — OpenRouter-first dan dual-adapter proof

**Tanggal:** 20 September 2026  
**Status:** design adopted for baseline 0.2; current implementation coverage is stated below, not a blanket production verification.\
**Dasar:** kebutuhan OpenRouter-first dan validasi kontrak [ADR-0002](0002-managed-envelope.md) melalui adapter kedua. Review baseline tetap dilacak melalui O11.

## Implementation reconciliation — 25 September 2026

OpenRouter and Direct Anthropic adapters are implemented in the local M2 gateway, with bounded SSE parsing, provider-specific usage normalization, explicit credential refs, structured-output validation, durable invocation evidence, and integration tests. Policy-approved fallback is allowed only for a `not-sent` primary failure before provider/output evidence; ambiguous or partial execution never splices a second route. Authorized live vendor smoke is still pending because provider credentials are not available in this workstation environment. See [current source state](../implementation/CURRENT-STATE.md), [active HTTP operations](../implementation/HTTP-API.md), and [verification scope](../reviews/CONTRACT-EXECUTION.md). This note updates implementation status only; it does not create new reviewer approval or erase the original decision history.

## Context

User memilih OpenRouter awal; pembuktian interface juga memerlukan direct adapter. Menentukan primary route berbeda dari memverifikasi abstraksi.

## Decision

Implementasikan OpenRouter lebih dahulu dan Direct Anthropic proof pada Phase 2. Default/alternate routes per profile; OpenRouter boleh primary. Proof mencakup shared capability, error, stream, usage. Operational failover memerlukan test terpisah dan policy/data/quality equivalence. Codex runtime tidak disamakan dengan OpenAI inference provider.

## Alternatives considered

Hanya satu adapter selamanya tidak dipilih. Membangun semua direct providers sejak MVP ditolak. Menurunkan OpenRouter menjadi fallback global tanpa requirement ditolak.

## Consequences and trade-offs

Satu direct proof menambah effort awal tetapi menguji mapping. Dua adapters tidak menghilangkan shared upstream outage atau menjamin kualitas model sama. Fallback bisa menambah biaya dan harus diaudit.

## Verification

G03/G16/G17; [PROFILES-ADAPTERS](../contracts/PROFILES-ADAPTERS.md).

## Evolution / revisit trigger

Tambah provider ketika data/availability/latency/workload membuktikan kebutuhan; jangan silently change primary for existing execution.

Navigasi keputusan: [ADR index](README.md). Peta pendukung: [traceability](../reviews/RECONCILIATION.md). Decision gaps: [OPEN-QUESTIONS](../decisions/OPEN-QUESTIONS.md).
