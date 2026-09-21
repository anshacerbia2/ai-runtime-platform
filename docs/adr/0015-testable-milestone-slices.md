# ADR-0015 — Testable milestone slices dan local Contract Lab

**Tanggal:** 21 September 2026 (Asia/Jakarta)

**Status:** adopted untuk implementasi M0 lokal; bukan production approval.

**Dasar:** user meminta FE, BE, dan DB tersedia sejak M0 supaya tiap fase dapat dicoba. Mengikuti [ADR-0001](0001-application-ownership.md), [ADR-0002](0002-managed-envelope.md), dan [ADR-0013](0013-evolution-gates.md).

## Status pemilihan stack

Pilihan Fastify standalone pada record awal ini digantikan oleh [ADR-0016](0016-nestjs-fastify.md) dan persistence raw-pg oleh [ADR-0017](0017-prisma-postgresql.md). Batas local contract-only dan testable milestone tetap berlaku. Struktur/quality mengikuti [ADR-0018](0018-clean-architecture-quality.md).

## Context

P0 semula hanya contract/decision closure. Dokumen saja tidak memberi feedback integrasi dari browser hingga database. Menjalankan model berbayar sebelum admission, credential policy, dan reliability siap justru melompati boundary P1/P2.

## Decision

Bangun vertical slice lokal: React + TypeScript/Vite frontend, Fastify backend, PostgreSQL terpisah, serta package Zod bersama untuk validation/type/JSON Schema. Dependency dikunci dalam package-lock.json; runtime yang diuji dicatat dalam milestone evidence. Schema execution v1 tetap draft, terpisah dari endpoint Contract Lab yang benar-benar berjalan.

M0 menyimpan hasil pemeriksaan kontrak ke schema `m0`, bukan membuat execution AI, reserve budget, menjalankan plugin, atau mengaku mengukur token. Demo profiles berlabel contract-only. Frontend memakai proxy server-side; local application credentials tidak dikirim ke browser. Tidak ada provider credential atau provider network call pada M0.

Database lokal native dipilih karena binary PostgreSQL tersedia pada workstation; cluster/data/port milik repo ini, tidak mengubah service atau database lain. Script menolak database non-loopback dan nama database di luar `ai_runtime_m0`. DATABASE_URL opsional hanya untuk database lokal khusus dengan nama tersebut. Deployment produksi tetap keputusan terpisah.

OpenAPI/JSON Schema dibuat dari shared contracts dan diuji terhadap drift. UI menyediakan payload examples, validation report, schema explorer, history, serta panduan fase. Nilai valid hanya berarti kontrak M0 lolos, bukan runtime/profile produksi telah verified. Session, artifact existence, real auth federation, rate/budget enforcement, dan distributed recovery tetap fase berikutnya.

## Alternatives considered

Docs-only tidak cukup untuk kebutuhan uji user. Mock database/browser-only ditolak karena tidak menguji persistence. Langsung membangun live agent/gateway ditolak karena melompati gate. Docker sistem tidak diwajibkan hanya untuk scaffold; native cluster tidak mengubah pilihan deployment produksi.

## Consequences and trade-offs

Ada development surface yang harus dijaga terpisah dari production API. M0 memerlukan Node dan PostgreSQL lokal; pin versi produksi dan upgrade PostgreSQL terpasang bukan bagian perubahan ini. Local app identity adalah development binding, bukan pengganti IAM produksi. Menutup pilihan stack M0 tidak menutup O11 atau mengklaim G01–G25 sudah lulus.

## Verification

Unit contract checks, schema export drift, API/database integration (scope, idempotency, concurrency, persistence), build/typecheck, serta browser smoke tests. Hasil aktual dan keterbatasan ada di [M0 record](../milestones/M0.md), bukan dianggap lulus hanya karena test file tersedia.

## Evolution / revisit trigger

Setiap milestone berikutnya menambah kemampuan nyata melalui UI + API + DB dan acceptance recipe. M1 mengganti persistence demo dengan control/accounting paths yang sesuai ADR, M2 mengaktifkan provider setelah policy/credentials siap, M3 agent setelah isolasi/recovery. Jangan menyambungkan Contract Lab langsung ke provider. Deployment atau perubahan stack besar membutuhkan ADR baru.

Panduan: [M0 local development](../development/M0.md). Review terbuka: [OPEN-QUESTIONS](../decisions/OPEN-QUESTIONS.md).

## Subsequent platform generalization

M0 local stack remains a testable contract slice. ADR-0019–ADR-0022 extend the target platform with application/connection registries, credential bindings, plugin packaging, optional workspaces, and distributed runners; none of those features are implied by the M0 local credential or single-machine development topology.
