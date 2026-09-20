# ADR-0001 — Application-owned workflow dan AI execution boundary

**Tanggal:** 20 September 2026  
**Status:** adopted for documentation baseline 0.2; implementation NOT VERIFIED.  
**Dasar:** SRC-U; P01. Amendments terhadap principal tetap membutuhkan disposition O11; ini bukan signature baru principal.

## Context

Platform melayani app yang memiliki business jobs sekaligus future direct-chat app tanpa job. Memusatkan seluruh workflow membuat platform bergantung domain dan memaksa chat menggunakan abstraksi palsu.

## Decision

App memiliki job/state bisnis, instruksi domain, retrieval/validation/review, dan publication. Platform memiliki execution/attempt, policy, lifecycle, results/events, dan usage. Correlation process/step/conversation opsional; authenticated identity dan execution ID selalu ada setelah acceptance. Identitas organisasi direuse lewat adapter bila kontraknya tersedia, bukan membangun IdP atau workflow engine baru.

## Alternatives considered

Universal business workflow engine ditolak karena melanggar product boundary. Setiap app langsung integrate provider selamanya tidak dipilih sebagai target karena memecah audit/policy. App-specific orchestration boleh tetap memakai existing tooling.

## Consequences and trade-offs

Integrasi app lebih kecil dan domain tetap independen. Platform harus menjaga execution errors tidak diperlakukan sebagai business outcome otomatis. Perlu client seam dan correlation mapping di setiap app.

## Verification

G01/G02/G21; direct chat tanpa job/plugin dan Scribe generate tanpa publikasi platform. Specification: [BOUNDARIES](../architecture/BOUNDARIES.md), [API](../contracts/API.md).

## Evolution / revisit trigger

Tinjau ulang hanya jika ada kebutuhan produk eksplisit untuk workflow service tersendiri; jangan mengubah ownership lewat fitur runtime kecil.

Provenance: [reconciliation register](../reviews/RECONCILIATION.md). Decision gaps: [OPEN-QUESTIONS](../decisions/OPEN-QUESTIONS.md).
