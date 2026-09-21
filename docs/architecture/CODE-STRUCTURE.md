# Code Structure — NestJS, Fastify, Prisma, dan Clean Architecture

**Implementasi:** M0 Contract Lab, 21 September 2026. Rancangan produksi tetap lebih luas daripada fitur yang sudah tersedia. Rujukan keputusan: [ADR-0016](../adr/0016-nestjs-fastify.md), [ADR-0017](../adr/0017-prisma-postgresql.md), [ADR-0018](../adr/0018-clean-architecture-quality.md).

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
      presentation/             # exception mapping, public route metadata
    infrastructure/
      config/                   # validated local environment/config
      database/                 # Prisma client lifecycle, seed, generated code
      http/                     # local transport host/origin policy
    modules/
      identity/
        domain/                 # ApplicationIdentity
        application/            # authenticate use case, verifier port
        infrastructure/         # local Prisma credential verifier
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
    cli/                        # seed/inspect entrypoints, not HTTP handlers
  web/src/
    app/                        # composition and shared workspace state
    features/
      contract-lab/             # page, hook, request/scenario/result components
      history/                  # persisted validation history
      schemas/                  # schema explorer
      roadmap/                  # milestone guide
    shared/
      api/                      # typed HTTP client and response parsing
      ui/                       # layout and reusable presentational components
      lib/                      # small pure helpers
packages/contracts/src/
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
  check-docs.mjs
  dev.mjs
  init-env.mjs                 # explicit .env initializer; refuses overwrite
```

Legacy SQL in `db/migrations/` is retained for checksum/history compatibility, not a second active migration system. Prisma generated files, local cluster, backups, screenshots, and logs remain Git-ignored.

## Arah dependency dan request

Dependency statis: `presentation -> application -> domain`; `infrastructure -> application ports/domain`; Nest composition boleh menghubungkan seluruhnya. Application tidak mengimpor concrete adapter. Runtime flow berbeda dari arah import:

```text
Browser feature -> HTTP client -> Nest controller
  -> ValidateContractUseCase
    -> ContractPolicy port -> ZodContractPolicy
    -> ValidationRepository port -> PrismaValidationRepository -> PostgreSQL
  <- plain saved record <- presenter <- typed browser response
```

Authentication memiliki port/use case sendiri. Query history selalu application-scoped. Tidak ada business job, provider call, atau financial ledger yang dibuat oleh request M0.

## Reading path konkret

Mulai dari `apps/api/src/modules/contract-lab/presentation/http/validations.controller.ts`, lalu `application/validate-contract.use-case.ts`, `application/ports/validation-repository.port.ts`, dan `infrastructure/prisma-validation.repository.ts`. Buka `contract-lab.module.ts` untuk melihat implementasi port yang di-inject. Unit tests menunjukkan use case dapat dijalankan tanpa HTTP/Nest/database.

Untuk frontend: `app/App.tsx` memilih fitur; `features/contract-lab/hooks/use-playground.ts` menangani editing/submission; components tidak berisi query DB. `shared/api` adalah batas network dan runtime parsing respons. No `any` sebagai jalan pintas terhadap bentuk data yang belum diketahui.

## Quality gates

`npm run verify` memeriksa format Prettier, ESLint, dependency/cycle rules, TypeScript source/tests/tools, unit contract/use-case/rule tests, Nest/Prisma integration, generated contract drift, build, serta tautan docs. `npm run test:e2e` menguji UI desktop/mobile terhadap backend dan database nyata. SQL custom constraints diuji langsung, tidak diasumsikan dari Prisma schema.

CI workflow menjalankan gate yang sama pada database disposable ketika perubahan dipublikasikan. Definisi workflow bukan bukti bahwa remote CI sudah dieksekusi. Evidence lokal dan batas cakupannya ada di [M0 record](../milestones/M0.md).

## Operating limits yang belum menjadi implementasi produksi

Keycloak/OIDC integration, per-app budget, distributed executions, SSE replay, sandbox, dan live provider adapters tetap fase selanjutnya. M0 mengikat loopback dan menolak production mode. Pilihan stack tetap tidak menghapus gate keamanan, data policy, credential rotation, patching, deployment/restore, load testing, atau per-app acceptance.
