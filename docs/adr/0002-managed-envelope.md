# ADR-0002 — Managed Execution Envelope dan typed profiles

**Tanggal:** 20 September 2026  
**Status:** adopted for documentation baseline 0.2; implementation NOT VERIFIED.  
**Dasar:** pemisahan lifecycle generik dan harness milik aplikasi, mengikuti [ADR-0001](0001-application-ownership.md). Review baseline tetap dilacak melalui O11.

## Context
Claude/Codex/Gemini berbeda dalam tools, sessions, approvals, dan usage granularity. Vendor-neutral HTTP tidak menjamin prompt behavior identik.

## Decision
Common contract menormalkan lifecycle/context/results/errors/usage. App-owned cognitive harness dipaketkan immutable; profile memisahkan runtime, model, provider, credential, tools, dan data policy. Compatibility dibuktikan per tuple/profile revision. Unsupported requirement ditolak sebelum dispatch. Direct inference tidak menjalankan agent loop tanpa permintaan.

## Alternatives considered

Universal translator semua agent ditolak. Vendor-specific payload bebas di API publik ditolak. Lowest-common-denominator API yang diam-diam membuang fitur ditolak; controlled profile extensions dipilih.

## Consequences and trade-offs

Caller memakai profile stabil, tetapi profile authors perlu runtime-specific packaging dan acceptance tests. Portability adalah investasi test, bukan janji hot-swap sessions.

## Verification

G03/G16/G20; [PROFILES-ADAPTERS](../contracts/PROFILES-ADAPTERS.md).

## Evolution / revisit trigger

Capability baru memakai schema version dan compatibility suite; breaking semantics memerlukan ADR baru.

Navigasi keputusan: [ADR index](README.md). Peta pendukung: [traceability](../reviews/RECONCILIATION.md). Decision gaps: [OPEN-QUESTIONS](../decisions/OPEN-QUESTIONS.md).
