# ADR-0021 — Optional Execution Workspace dan Remote Tool Model

**Tanggal:** 21 September 2026 (Asia/Jakarta)

**Status:** adopted in documentation; implementation mulai P3.

## Implementation reconciliation — 24 September 2026

Runtime workspace and MCP/remote-tool adapters remain planned. Artifact metadata and web sessions are not implementation of agent workspace/session execution. See [current source state](../implementation/CURRENT-STATE.md), [active HTTP operations](../implementation/HTTP-API.md), and [verification scope](../reviews/CONTRACT-EXECUTION.md). This note updates implementation status only; it does not create new reviewer approval or erase the original decision history.

## Context

Scribe V2 memakai pola in/out/result.json, tetapi direct chat dan banyak inference request tidak membutuhkan filesystem workspace. Platform harus menggeneralisasi pola artifact tanpa menjadikan struktur Scribe sebagai kontrak universal.

## Decision

Execution Profile mendeklarasikan workspace mode: `none`, `ephemeral`, atau `artifact_workspace`. Hanya profile yang memerlukan filesystem mendapat isolated workspace.

Artifact input diberikan sebagai logical artifact reference, bukan host path. Platform materialize input ke sandbox. Output file dipromosikan ke Artifact Store setelah validation/checksum; worker-local filesystem tidak menjadi durable result.

Platform memiliki generic execution result/artifact manifest. Domain-specific result seperti Scribe `result.json` adalah extension/payload milik aplikasi atau plugin, bukan schema wajib semua execution.

Tool taxonomy: platform-owned tool, packaged plugin tool, dan remote app/service-owned tool. Remote tool dapat memakai MCP atau typed HTTP/RPC. Mutating remote tool tetap wajib stable logical operation/idempotency key dan status reconciliation.

## Consequences

Direct chat dapat berjalan tanpa plugin/workspace. Agent dokumen dapat memakai workspace. Domain mutation tetap di service pemilik domain kecuali secara eksplisit didelegasikan melalui tool contract.

## Verification

Uji workspace none, cleanup, artifact promotion, traversal, oversized output, unauthorized artifact reference, malformed manifest, remote-tool retry, dan ambiguous external side effect.

## Revisit trigger

Revisit jika runtime tertentu membutuhkan persistent session filesystem; persistent state harus tetap scoped dan tidak mengubah ephemeral default.
