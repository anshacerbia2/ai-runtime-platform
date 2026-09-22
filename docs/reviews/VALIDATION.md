# Documentation Validation Record

**Tanggal:** 20 September 2026 · **Baseline:** 0.2 · **Lingkup:** dokumentasi, bukan runtime implementation.

Bagian 1–4 mempertahankan hasil validasi baseline awal; bagian 5 merekam relokasi terdahulu. Hasil tersebut bukan klaim pengujian ulang saat pemeliharaan rujukan ADR pada bagian 6. Keputusan aktif dirujuk melalui [ADR](../adr/README.md).

## 1. Pemeriksaan baseline awal — catatan historis

| Check                | Recorded result                                                                        | Scope / limitation                                                             |
| -------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Markdown target set  | 51 authored files prepared: 3 existing source docs updated, 48 new docs                | Lingkup penulisan baseline saat itu                                            |
| Relative links       | 252 targets checked; 0 missing                                                         | Historical file-target check; not the current link count                       |
| UTF-8 encoding       | PASS: Unicode punctuation verified after readback                                      | Authored baseline Markdown stored as UTF-8 without BOM                         |
| Fenced code blocks   | Balanced in every authored document                                                    | Does not compile illustrative TypeScript/pseudocode                            |
| JSON examples        | 7 valid JSON examples                                                                  | Not an implemented API validator                                               |
| ADR structure        | 14 ADRs contain context, decision, alternatives, consequences, verification, evolution | Adopted design is not implementation proof                                     |
| Gate references      | G01–G25 references checked against catalogue                                           | All implementation gates NOT RUN                                               |
| Mermaid parse/render | 24 of 24 passed with Mermaid 11.12.2 and Chromium 144.0.7559.96                        | Historical offline render, not a guarantee of identical layout in every viewer |
| Visual spot-check    | Chat sequence, public-state flow, and ERD inspected                                    | Not a pixel-by-pixel review of every viewport                                  |
| Exact source match   | Diagram source manifest SHA-256 matched between remote draft and renderer              | Historical digest recorded below                                               |
| Local write/readback | PASS: 51 authored Markdown files written and SHA-256 readback matched                  | Baseline check, not a new hash check during reference maintenance              |
| Git publication      | Separate post-validation step, explicitly requested at the time                        | See repository history; runtime gates remain NOT RUN                           |

One Mermaid sequence label initially failed because its semicolon was interpreted as a statement separator. The label was corrected and all 24 diagrams were reparsed and rendered successfully. The successful baseline checks used installed Mermaid modules loaded in memory, without adding renderer dependencies to the user's repository. No fresh render is claimed by retaining this historical record.

## 2. Historical render source manifest

Combined ordered diagram source digest recorded at baseline:
`5c189ad1346c52c6b714fa9a8bb0196c6a37faeb50ab21e1e39e40d832f37ddc`.

| Document                                                                                   | Diagram index in file | Historical parse/render | Source SHA-256 prefix |
| ------------------------------------------------------------------------------------------ | --------------------- | ----------------------- | --------------------- |
| [ARCHITECTURE.md](../architecture/ARCHITECTURE.md)                                         | 1                     | PASS                    | `f8be6d7ea75584c2`    |
| [docs/diagrams/01-system-context.md](../diagrams/01-system-context.md)                     | 1                     | PASS                    | `255f6481a51d10e3`    |
| [docs/diagrams/01-system-context.md](../diagrams/01-system-context.md)                     | 2                     | PASS                    | `1b7f0c5a6b5c123c`    |
| [docs/diagrams/01-system-context.md](../diagrams/01-system-context.md)                     | 3                     | PASS                    | `36a492b2afbf020f`    |
| [docs/diagrams/02-direct-inference.md](../diagrams/02-direct-inference.md)                 | 1                     | PASS                    | `e558e098f62924ca`    |
| [docs/diagrams/02-direct-inference.md](../diagrams/02-direct-inference.md)                 | 2                     | PASS                    | `ba9c516b013a11b1`    |
| [docs/diagrams/03-agent-execution.md](../diagrams/03-agent-execution.md)                   | 1                     | PASS                    | `4353c6095e1fccf8`    |
| [docs/diagrams/03-agent-execution.md](../diagrams/03-agent-execution.md)                   | 2                     | PASS                    | `e01351ee99fa538c`    |
| [docs/diagrams/03-agent-execution.md](../diagrams/03-agent-execution.md)                   | 3                     | PASS                    | `0d64f04d994b9037`    |
| [docs/diagrams/04-recovery-cancellation.md](../diagrams/04-recovery-cancellation.md)       | 1                     | PASS                    | `13fc80f34c4e6899`    |
| [docs/diagrams/04-recovery-cancellation.md](../diagrams/04-recovery-cancellation.md)       | 2                     | PASS                    | `32324af362facafb`    |
| [docs/diagrams/04-recovery-cancellation.md](../diagrams/04-recovery-cancellation.md)       | 3                     | PASS                    | `ae0dfe8d4fd8f426`    |
| [docs/diagrams/04-recovery-cancellation.md](../diagrams/04-recovery-cancellation.md)       | 4                     | PASS                    | `4f0636467962e474`    |
| [docs/diagrams/05-budget-accounting.md](../diagrams/05-budget-accounting.md)               | 1                     | PASS                    | `baa6ffafeddc2a0a`    |
| [docs/diagrams/05-budget-accounting.md](../diagrams/05-budget-accounting.md)               | 2                     | PASS                    | `336ce531ad53066a`    |
| [docs/diagrams/05-budget-accounting.md](../diagrams/05-budget-accounting.md)               | 3                     | PASS                    | `f6f2c88ab382ec9e`    |
| [docs/diagrams/06-streaming-artifacts.md](../diagrams/06-streaming-artifacts.md)           | 1                     | PASS                    | `81b18a92d11c93dd`    |
| [docs/diagrams/06-streaming-artifacts.md](../diagrams/06-streaming-artifacts.md)           | 2                     | PASS                    | `9669ff301963db74`    |
| [docs/diagrams/06-streaming-artifacts.md](../diagrams/06-streaming-artifacts.md)           | 3                     | PASS                    | `a0d23be5ee32f65d`    |
| [docs/diagrams/07-deployment-data-security.md](../diagrams/07-deployment-data-security.md) | 1                     | PASS                    | `f4dd92810e14c30f`    |
| [docs/diagrams/07-deployment-data-security.md](../diagrams/07-deployment-data-security.md) | 2                     | PASS                    | `9e451fce228cc546`    |
| [docs/diagrams/07-deployment-data-security.md](../diagrams/07-deployment-data-security.md) | 3                     | PASS                    | `1a46db51f252e019`    |
| [docs/diagrams/08-evolution-migration.md](../diagrams/08-evolution-migration.md)           | 1                     | PASS                    | `ac067a6414e67617`    |
| [docs/diagrams/08-evolution-migration.md](../diagrams/08-evolution-migration.md)           | 2                     | PASS                    | `dafa005cc912b465`    |

## 3. Scope dan rujukan aktif

Baseline awal menggunakan Git commit `376d435bf43589784b1f1a5d76f88be33b233365` sebagai pembanding. Hash diagram di atas adalah catatan baseline, bukan pemeriksaan ulang file aktif. Keputusan saat ini dibaca dari [ADR](../adr/README.md); pemetaan ke spesifikasi/gate ada di [RECONCILIATION](RECONCILIATION.md), referensi pendukung di [SOURCES](SOURCES.md).

Only Markdown documentation is included in this change. Validation helpers and renderer dependencies were not added to the repository. Riwayat sumber yang telah dihapus tetap merupakan sejarah Git, bukan file yang harus tersedia untuk validasi atau navigasi aktif.

## 4. Checks not performed or not implied

M0 local FE/API/PostgreSQL code now exists and its evidence is recorded separately in [M0](../milestones/M0.md). No live provider/agent execution, production budget ledger, distributed runner fleet, plugin registry, Keycloak federation, secret-manager integration, load test, sandbox attack test, billing reconciliation, failover drill, deployment, atau production cutover has been demonstrated. G01–G35 remain **NOT RUN** as production gates. P3.5 remains blocked pending actual implementation evidence.

Relative-link and diagram validation does not certify contracts, compliance, capacity, timing SLOs, security containment, or financial completeness. [Open decisions](../decisions/OPEN-QUESTIONS.md) retain owner decisions and baseline review. Changing references to ADR does not grant approval of an unreviewed revision.

## 5. Relokasi dokumentasi — catatan historis, 20 September 2026

`PLAN.md`, `ROADMAP.md`, dan `CHANGELOG.md` dipindahkan ke `docs/`. `ARCHITECTURE.md` sudah dipindahkan oleh user ke `docs/architecture/ARCHITECTURE.md`; tautan masuk dan tautan relatif di dalamnya disesuaikan. README tetap di root.

Pada pemeriksaan relokasi terdahulu: 51 dokumen aktif dan satu sumber review historis tersedia; 252 tautan relatif diperiksa dengan kecocokan kapitalisasi, tanpa target hilang. Sebanyak 46 tujuan tautan disesuaikan. Fenced blocks, 24 diagram Mermaid, dan 7 contoh JSON tetap sama; JSON diparse ulang saat itu. Diagram tidak dirender ulang pada relokasi.

Sumber review historis masih dibiarkan utuh pada langkah relokasi tersebut dan kemudian dihapus oleh user. Pernyataan historis ini tidak menyatakan file tersebut masih tersedia sekarang. Pekerjaan relokasi tidak mengubah keputusan arsitektur, kontrak eksekusi, kode runtime, Git index, commit, atau push.

## 6. Pemeliharaan rujukan ADR — 20 September 2026

Rujukan keputusan aktif dipindahkan ke 14 ADR, dengan konteks mandiri, cross-reference, dan peta keputusan ke spesifikasi/gate. Sumber historis yang dihapus tidak dibuat ulang. Catatan integritas sumber yang tidak lagi tersedia tidak digunakan sebagai syarat validasi aktif. Audit penggunaan token tetap merupakan fungsi platform.

Pemeliharaan dilakukan melalui operasi baca/tulis file dan pencarian konten. Pemeriksaan scripted hash/link checker serta render ulang tidak dijalankan karena akses terminal tidak tersedia pada sesi ini. Hasil validasi baseline di bagian 1–5 tidak dipresentasikan sebagai pengujian baru. Tidak ada commit atau push pada pekerjaan ini.

Hasil pemeliharaan: 25 dokumen diperbarui. Pemindaian seluruh Markdown terhadap nama sumber review yang dihapus, identifier sumber lama, dan frasa navigasi lama menghasilkan 0 kecocokan. Readback README, indeks ADR, arsitektur, bagian akhir plan, dan catatan validasi mengonfirmasi struktur utuh. Target ADR pada navigasi cocok dengan file yang tersedia. Pemeriksaan ini tidak menggantikan automated link checker, hash verification, atau runtime gate.

## 7. Pemeriksaan sebelum commit reorganisasi ADR

51 dokumen Markdown dan 360 tautan relatif diperiksa ulang melalui terminal: tidak ada target hilang atau rujukan ke file review yang sudah dihapus. Fenced blocks seimbang. Pemeriksaan ini menggantikan keterbatasan akses terminal pada langkah sebelumnya, bukan klaim pengujian runtime atau render ulang.

## 8. Implementasi M0 lokal

Catatan baseline dokumentasi di atas bersifat historis. M0 sekarang menambahkan kode FE/BE, PostgreSQL, schema export dan tests. Hasil aktual dan batas verifikasi ada pada [milestone M0](../milestones/M0.md). Tes runtime/platform produksi tetap NOT RUN; lokal Contract Lab tidak mengesahkan implementasi gateway, agent, financial ledger atau sandbox.

## Refactor NestJS/Fastify/Prisma

Pemeriksaan source, dependency, database, migration, dan browser terbaru dicatat di [M0 refactor evidence](../milestones/M0.md). Hasil baseline sebelumnya tetap historis; belum ada load test SSE, provider smoke, atau deployment produksi. Rujukan keputusan terbaru: [ADR-0016](../adr/0016-nestjs-fastify.md), [ADR-0017](../adr/0017-prisma-postgresql.md), dan [ADR-0018](../adr/0018-clean-architecture-quality.md).

## 9. Platform-control/fleet synchronization — 21 September 2026

ADR-0019–ADR-0024, Control Plane contract, the then-current ATI One internal-app/frontend architecture, distributed-runner diagram, architecture/boundaries, API/profile/plugin/artifact contracts, data/accounting/security/reliability/deployment/runbooks, acceptance gates, migration, PLAN, ROADMAP, glossary/index/changelog, dan milestone scope notes were synchronized for the requirements current on 21 September 2026. ADR-0025/0026 later supersede the hosting/BFF portion; see section 12.

Automated documentation checks evolved from **64 Markdown files / 489 local links**, to **65 / 503**, **66 / 509**, **70 / 534**, and then **70 / 535**, always with 0 missing file targets. Those are historical checkpoints. The current post-ADR-0025/0026 count is recorded in section 12.

At that checkpoint, production gates spanned **G01–G38**. G26–G35 covered application/connection isolation, secret handling, dedicated/shared connection semantics, runner registration/lifecycle, runner-local credential locality, shared quota groups, plugin supply-chain checks, optional workspace containment, optional remote-tool/MCP semantics, and fleet failover/fencing. The old G36–G38 internal-app wording is superseded by section 12. Local M1 evidence covers P1 scenarios G01/G02/G07/G08/G09/G15/G26–G29; this is not a production gate PASS and does not imply live Keycloak, BFF, Redis, provider/runtime, or P3.5 evidence.

M0 still does not implement Keycloak federation, Admin control-plane management, AI Connection/Credential Binding, Plugin Registry, distributed runner placement, Vault integration, remote MCP tools, or production workspace/artifact promotion. M1 now implements the local P1 durable foundation: application/operator/runner authority separation, OIDC/JWKS verifier behavior, management mutations, profiles, admission/idempotency, accounting/ledger, outbox/inbox, audit, artifact metadata, and runner registry foundation. Local P1 acceptance evidence is recorded in [M1](../milestones/M1.md); live ATI Keycloak/ATI One, Redis hot-state deployment, concrete secret-manager, and production gates remain incomplete.

## 10. Single environment configuration gate — 21 September 2026

M0 local runtime/tooling configuration was consolidated behind `config/environment.mjs`. Local development uses Git-ignored `.env`; CI supplies the same required variables explicitly. Vite, Nest/Fastify, Prisma, Playwright, PostgreSQL setup/migration, contract export, dev runner, and tests now consume that validated boundary.

Automated environment-boundary tests verify required values fail closed, boolean values are explicit, application/scripts source does not directly read env variables outside the gate, and no active source reads `.local/config.json`. Legacy `.local/config.json` was deleted after migration. The current M0+M1 suite now passes **30 contract tests, 24 unit/tooling tests, 30 integration tests, and 6 E2E tests**.

`DATABASE_URL` is no longer an alternate input path, PostgreSQL binary discovery was removed, and required port/browser/timeout/pool/path values have no silent fallback. M1 extends the same single environment gate with separate local operator/runner credentials and fail-closed `m1-oidc` ATI One/OIDC configuration. The OIDC verifier is tested locally with generated signing keys/JWKS transport; live ATI Keycloak and production secret-manager/deployment evidence remain future work.

## 11. Frontend CDD/design-system implementation — 22 September 2026

The M0/M1 console now implements the frontend architecture in ADR-0024: semantic design tokens, leaf primitives, reusable components, explicit Sidebar/TopBar/PageRegion/PageHeader compositions, feature-owned orchestration, and a resource-based M1 Control Plane admin console.

Local frontend evidence includes:

- `npm run ui:check` PASS: raw color literals, obvious raw visual dimensions, and inline-style bypasses are rejected outside the token source;
- frontend TypeScript typecheck PASS;
- Playwright **6/6 PASS** across Contract Lab, validation replay, History, Schema Explorer, Delivery Plan, M1 Control Plane resources, custom Select keyboard/type-ahead/outside-click behavior, desktop screenshot, and phone-width overflow checks;
- mobile page width remains bounded while data tables retain their own scroll regions;
- browser-visible Control Plane responses remain free of `secretRef`, `secret_ref`, and secret URI material;
- reduced-motion and focus-visible behavior are provided by the shared design-system layer.

This is local UI/architecture evidence. The old ATI One iframe/mount evidence item is superseded; current nonlocal web-identity/BFF evidence is defined by G36–G39 in section 12 and the Acceptance Catalogue.

> Superseded in part on 22 September 2026. ATI One mount/iframe behavior is no longer an evidence item; see section 12. The CDD/design-token evidence above stands unchanged.

## 12. External-app delivery and Next.js BFF adoption — 22 September 2026

This is a **documentation-only** synchronization. No runtime or source implementation was changed, and nothing in it constitutes implementation evidence.

Web delivery moved from ATI One internal-app hosting to external-app delivery on the platform's own public origin, and the web tier adopted Next.js App Router with a Backend-for-Frontend. Added [ADR-0025](../adr/0025-external-app-standalone-auth.md) and [ADR-0026](../adr/0026-nextjs-bff.md); [ADR-0023](../adr/0023-ati-one-internal-app.md) is partially superseded, with its dedicated-client, cookie-isolation, and authorization-boundary decisions still in force.

Retired: the `/apps/<app-id>/app` mount prefix, per-app proxy-origin verification, mount-scoped cookie paths, the frame-compatibility requirement, and `M1_PROXY_SECRET`. Framing is now denied. Added: a platform-owned entry page with an explicit Authorization Code sign-in, server-side token custody, `M1_SESSION_SECRET`, and a server-rendered `docs/` surface.

Gate changes: G36 restated from ATI One mount/SSO to entry-page sign-in and callback registration; G37 restated from proxy/cookie isolation to BFF token custody; G38 restated from internal-app viewports to standard viewports; **G39 added** for the BFF boundary. Production gates now span **G01–G39**.

Synchronized documents: frontend/code-structure/architecture/boundaries, security, deployment, configuration, acceptance, ADR catalogue, M1 milestone scope, PLAN, ROADMAP, INDEX, README, open questions, control-plane contract, and changelog.

The automated documentation check after this synchronization is **72 Markdown files, 585 local links, 0 missing file targets**, and `prettier --check .` passes. These verify link integrity and formatting only; they assert nothing about the decisions themselves.

Implementation deliberately not started: the Vite-to-Next.js move, the BFF tier, the entry page, and the affected tooling (`scripts/dev.mjs`, `scripts/check-ui-tokens.mjs`, `scripts/lib/dependency-rules.mjs`, `config/hosting.mjs`, `playwright.config.ts`, `apps/web/package.json`). Those files still encode the internal-app/Vite contract and are known to be inconsistent with this documentation until the implementation lands.

## 13. Next.js/BFF implementation and regression verification

This supersedes section 12's documentation-only implementation status. The Vite entry/configuration/dependencies are removed. React components and SCSS are retained under Next.js App Router, with a public entry, stable feature routes, thin BFF handlers, and server-rendered documentation. The API no longer grants or requires proxy-header authority.

Verified locally against the project PostgreSQL environment and a freshly started Next.js development server:

| Check                                    | Result and scope                                                                                       |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `npm run verify`                         | PASS: formatting, lint, boundaries, types, contracts, backend, BFF, build, and docs checks             |
| Contract tests                           | 30 PASS                                                                                                |
| API unit tests                           | 12 PASS                                                                                                |
| Architecture/configuration tooling tests | 16 PASS                                                                                                |
| M0/M1 integration tests                  | 30 PASS against PostgreSQL                                                                             |
| BFF/protocol/session/Markdown tests      | 25 PASS with generated signing keys and injected issuer/store transports                               |
| Browser E2E                              | 9 PASS; new server startup, no reuse of an old development server                                      |
| Production web build                     | Next.js App Router build PASS                                                                          |
| Production client-bundle check           | PASS; 36 client files and 15 reference manifests checked for configured secrets/server-only references |
| PostgreSQL migrations                    | No schema or migration changes introduced by this framework migration                                  |

The web tests exercise state/nonce/PKCE/signature/issuer/audience validation, callback replay rejection, concurrent refresh, logout during refresh, encrypted server-side storage with opaque cookies, CSRF, duplicate cookie rejection, route/method allowlists, bounded bodies, upstream failure masking, and Markdown traversal/XSS rejection. Browser tests exercise the new entry, reload/back navigation, app-local logout, existing M0/M1 workflows, mobile overflow, and docs without client JavaScript.

Local evidence logs: `.local/next-verify.log` and `.local/next-e2e.log`; screenshots remain in Git-ignored `test-results/`. These are local checks, not a live ATI Keycloak or production security certification.

The real two-client Redis integration suite is provided as `npm run test:web:redis` and is included in CI with a disposable Redis service. It was not executed on this workstation because no isolated Redis service was available. Do not infer a Redis integration PASS from the in-process session tests. Live issuer registration, protected Redis availability/TLS/ACLs, ingress isolation, replica failure, and operational sign-offs remain deployment evidence.
