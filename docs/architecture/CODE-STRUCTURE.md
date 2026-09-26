# Code Structure — NestJS, Fastify, Prisma, dan Clean Architecture

**Implementasi:** M0/M1 console with Next.js App Router and BFF. Rancangan produksi tetap lebih luas daripada fitur yang sudah tersedia. Rujukan keputusan: [ADR-0016](../adr/0016-nestjs-fastify.md), [ADR-0017](../adr/0017-prisma-postgresql.md), [ADR-0018](../adr/0018-clean-architecture-quality.md), [ADR-0026](../adr/0026-nextjs-bff.md).

## Struktur repository

```text
.env.example                   # exhaustive local/CI config contract; no secrets
config/
  environment.mjs             # single validated environment read boundary
  environment.d.mts           # typed shape for TypeScript consumers
apps/
  api/src/
    main.ts                     # startup, listen, shutdown
    bootstrap.ts                # Nest + FastifyAdapter
    app.module.ts               # composition root
    shared/
      domain/                   # framework-independent errors
      presentation/             # contract binding, exception mapping, public route metadata
      infrastructure/           # bounded finite JSON representation validator
    infrastructure/
      config/                   # validated local environment/config
      database/                 # Prisma client lifecycle, seed, generated code
      http/                     # local transport host/origin policy
    modules/
      identity/
        domain/                 # ApplicationIdentity
        application/            # authenticate use case, verifier port
        infrastructure/         # local principal + OIDC/JWKS verifiers
        presentation/http/      # guard and authenticated-request binding
        identity.module.ts
      contract-lab/
        domain/                 # validation records, idempotency invariant
        application/
          ports/                # repository, profile, policy, health contracts
          *.use-case.ts         # framework-free orchestration
        infrastructure/         # Prisma repositories, mappers, Zod policy
        presentation/http/      # controllers, query parsing, response presenter
        contract-lab.module.ts
      control-plane/
        application/            # management/resource/runner services and ports
        infrastructure/         # Prisma mutation/receipt, paged reads, fencing, wire mappers
        presentation/http/      # legacy, resource and runner-authority controllers
        control-plane.module.ts
    cli/                        # seed/inspect entrypoints, not HTTP handlers
  web/                          # Next.js App Router + BFF (ADR-0026)
    next.config.mjs
    src/
      app/                      # routes and route handlers only
        (public)/               # unauthenticated entry page
        (console)/              # authenticated shell and feature routes
        auth/                   # login, callback, logout route handlers
        api/[...path]/          # authenticated forwarding to apps/api
      server/                   # server-only; Node built-ins permitted here
        auth/                   # OIDC client, code exchange, refresh
        session/                # cookie sealing, session read/write
        api-gateway/            # server-side calls into apps/api
        docs/                   # docs/ Markdown reader
      design-system/
        primitives/             # leaf controls
        components/             # Badge, Panel, MetricCard, DataTable, EmptyState
        compositions/           # AppShell, Sidebar, TopBar, PageRegion, PageHeader
      features/
        auth/                   # standalone sign-in schematic
        workspace/              # catalogue orchestration + console shell
        contract-lab/           # engineering workbench
        control-plane/          # M1 operator resource console
        history/                # persisted validation audit surface
        schemas/                # technical schema catalogue
        roadmap/                # delivery reference
      shared/
        api/                    # inferred operations, bounded reads/retry, query/mutation state
        ui/                     # exceptional shared feedback only
        lib/                    # small pure helpers
      styles/
        tokens/                 # raw visual values -> semantic --ds-* contract
        foundations/ layouts/ components/ features/
        main.scss               # single stylesheet entry point
packages/contracts/src/
  http/                         # routes/resources/runner, wire views, behavior and OpenAPI
  control-plane.ts              # strict typed management/admission/evidence commands
  schemas/                      # requests, execution, events, profiles, errors
  validation/                   # bounded policies, metadata, canonical digest input
  fixtures/                     # synthetic examples and demo profiles
  schema-bundle.ts              # machine-readable export registry
  index.ts                      # stable public package exports
prisma/
  schema.prisma
  migrations/                   # reviewed SQL, including data-preserving baseline
scripts/
  database/                     # guarded migrate/baseline orchestration
  lib/                          # dependency rules used by checker and tests
  test/                         # negative architecture-rule fixtures
  check-architecture.mjs
  check-http-contracts.mjs
  check-serialization.mjs
  check-ui-tokens.mjs
  check-web-bundle.mjs
  check-docs.mjs
  dev.mjs
  init-env.mjs                 # explicit .env initializer; refuses overwrite
```

Legacy SQL in `db/migrations/` is retained for checksum/history compatibility, not a second active migration system. Prisma generated files, local cluster, backups, screenshots, and logs remain Git-ignored.

## Arah dependency dan request

Dependency statis: `presentation -> application -> domain`; `infrastructure -> application ports/domain`; Nest composition boleh menghubungkan seluruhnya. Application tidak mengimpor concrete adapter. Runtime flow berbeda dari arah import:

```text
Browser feature -> BFF route handler (session -> bearer token) -> Nest controller
  -> ValidateContractUseCase
    -> ContractPolicy port -> ZodContractPolicy
    -> ValidationRepository port -> PrismaValidationRepository -> PostgreSQL
  <- plain saved record <- presenter <- typed browser response
```

Authentication memiliki port/use case sendiri. Query history selalu application-scoped. Tidak ada business job, provider call, atau financial ledger yang dibuat oleh request M0.

## Reading path konkret

Mulai dari `apps/api/src/modules/contract-lab/presentation/http/validations.controller.ts`, lalu `application/validate-contract.use-case.ts`, `application/ports/validation-repository.port.ts`, dan `infrastructure/prisma-validation.repository.ts`. Buka `contract-lab.module.ts` untuk melihat implementasi port yang di-inject. Unit tests menunjukkan use case dapat dijalankan tanpa HTTP/Nest/database.

Frontend mengikuti [FRONTEND](FRONTEND.md) secara langsung: `app/` hanya memegang route dan route handler; `server/` memegang session, OIDC, forwarding, dan pembaca Markdown; `styles/tokens` memegang ATI source tokens + semantic aliases; `design-system/primitives`, `components`, dan `compositions` menyediakan reusable contracts; `styles/foundations`, `styles/layouts`, `styles/components`, dan `styles/features` memegang SCSS per layer; feature modules memiliki domain state/orchestration; `shared/api` tetap menjadi runtime-parsing boundary. `apps/web/src/styles/main.scss` adalah satu stylesheet entry point. No `any` digunakan sebagai jalan pintas terhadap bentuk data yang belum diketahui.

Selain arah layering di atas berlaku **execution-context boundary**: Node built-ins hanya boleh diimpor di bawah `apps/web/src/server/`, dan route handler tetap tipis dengan mendelegasikan ke sana. Larangan mengimpor Nest, Prisma, atau database driver di bawah `apps/web/` berlaku mutlak pada kedua context. BFF tidak memegang domain mutation/authorization authority atau koneksi database; ia tetap melakukan wire-schema validation/projection pada forwarding boundary. Setiap operasi domain adalah panggilan ke `apps/api`.

## Resource, receipt dan runner reading paths

Management baru: resource.controller.ts -> ResourceService -> PrismaM1Repository.manageReceipted -> mutation/audit/ManagementReceipt dalam transaksi yang sama. Legacy controller memakai manage tanpa receipt, tetapi shared command application tetap sama. Granular endpoint tidak berarti setiap resource sudah menjadi microservice atau seluruh method mutation terpisah ke file sendiri.

Reads: ResourceController -> ResourceService -> ResourceReader port -> PrismaResourceReader. DB projection dan keyset limit dilakukan sebelum response dibentuk. UI memakai controlPlaneClient.list per resource dan count-only overview; bukan legacy snapshot.

Runner: RunnerAuthorityController -> RunnerAuthorityService -> RunnerAuthority port -> PrismaRunnerAuthority. Grant/revoke/report/evidence mempunyai auth dan exact durable generation checks; tidak ada dispatch/provider loop di service ini. [Route inventory](../implementation/HTTP-API.md) dan [I01–I04](../diagrams/10-implemented-contracts.md) melengkapi file tree.

Database representation validator berada di shared/infrastructure/json-value.ts; wire mappers di control-plane/infrastructure/wire-mappers.ts. Prisma types tidak diimpor runtime ke application/domain. Explicit converter bukan alasan meniadakan schema validation di provider/BFF.

## Quality gates

`npm run verify` memeriksa format Prettier, ESLint, dependency/cycle rules, UI semantic-token boundary (`npm run ui:check`), TypeScript source/tests/tools, unit contract/use-case/rule tests, Nest/Prisma integration, web/BFF tests, current/frozen Pact provider verification, serialization AST checks, generated contract drift, production bundle check, build, serta tautan docs. `npm run test:e2e` menguji UI desktop/mobile terhadap backend dan database nyata. SQL custom constraints diuji langsung, tidak diasumsikan dari Prisma schema.

CI workflow menjalankan gate yang sama pada database disposable ketika perubahan dipublikasikan. Definisi workflow bukan bukti bahwa remote CI sudah dieksekusi. Evidence lokal dan batas cakupannya ada di [contract execution](../reviews/CONTRACT-EXECUTION.md), [M0](../milestones/M0.md), dan [M1](../milestones/M1.md).

## Operating limits yang belum menjadi implementasi produksi

M1 kini mengimplementasikan OIDC/JWKS verifier boundary, application-scoped budgets/admission/accounting, and durable runner registry plus manual assignment/fencing/evidence intake secara lokal. Live ATI Keycloak/ATI One flow, Redis runner hot state/placement, distributed executions, SSE replay, sandbox, dan live provider adapters tetap deployment/fase berikutnya. M0 local mode tetap mengikat loopback. Pilihan stack tetap tidak menghapus gate keamanan, data policy, credential rotation, patching, deployment/restore, load testing, atau per-app acceptance.
