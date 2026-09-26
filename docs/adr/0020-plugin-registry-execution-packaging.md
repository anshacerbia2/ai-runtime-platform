# ADR-0020 — Plugin Registry dan Execution Packaging

**Tanggal:** 21 September 2026 (Asia/Jakarta)

**Status:** adopted in documentation; implementation bertahap P2–P3.

## Implementation reconciliation — 24 September 2026

Plugin Registry, artifact package signing and ephemeral materialization remain target design. No corresponding executable plugin model/route is introduced by the resource API changes. See [current source state](../implementation/CURRENT-STATE.md), [active HTTP operations](../implementation/HTTP-API.md), and [verification scope](../reviews/CONTRACT-EXECUTION.md). This note updates implementation status only; it does not create new reviewer approval or erase the original decision history.

## Context

Plugin seperti Scribe membutuhkan prompts, skills, scripts, atau runtime-specific assets, tetapi platform tidak boleh mengasumsikan semua workload memiliki plugin dan tidak boleh memasang arbitrary plugin permanen pada API/control-plane host.

## Decision

Plugin adalah immutable versioned execution package di Plugin Registry. Setiap version memiliki artifact reference, content digest, compatibility metadata, required permissions, dan lifecycle status.

Execution Profile boleh mereferensikan plugin/harness secara opsional. Scheduler hanya menempatkan execution pada worker/runtime yang compatible. Worker memverifikasi digest, materialize package ke sandbox secara ephemeral, menjalankan, lalu membuang workspace sesuai retention policy.

Control Plane tidak menjalankan arbitrary plugin code. Plugin tidak menerima provider secret secara default; capability diberikan least-privilege melalui runtime/tool/workspace policy.

MCP bukan requirement plugin. Remote capabilities dapat memakai MCP atau typed HTTP/RPC adapter bila capability harus tetap hidup di service pemilik domain.

## Consequences

Versi plugin dapat coexist, rollback, dan dipin oleh profile. Supply-chain verification menjadi bagian admission. Package app/team-owned dapat dieksekusi platform tanpa menjadikan filesystem host sebagai deployment contract.

## Verification

Uji digest mismatch, revoked version, incompatible runtime, path traversal, undeclared permission, secret access, concurrent versions, rollback, dan cleanup sandbox.

## Revisit trigger

Revisit bila packaging runtime tertentu membutuhkan image-per-plugin atau signed OCI artifact sebagai distribution primitive.
