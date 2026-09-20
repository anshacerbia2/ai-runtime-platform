# ADR-0004 — OpenRouter-first dan dual-adapter proof

**Tanggal:** 20 September 2026  
**Status:** adopted for documentation baseline 0.2; implementation NOT VERIFIED.  
**Dasar:** kebutuhan OpenRouter-first dan validasi kontrak [ADR-0002](0002-managed-envelope.md) melalui adapter kedua. Review baseline tetap dilacak melalui O11.

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
