import { RunnerAuthorityController } from './presentation/http/runner-authority.controller.js';
import { RunnerAuthorityService } from './application/runner-authority.service.js';
import {
  RUNNER_AUTHORITY,
  type RunnerAuthority,
} from './application/runner-authority.port.js';
import { PrismaRunnerAuthority } from './infrastructure/prisma-runner-authority.js';
import { Module } from '@nestjs/common';
import { ResourceController } from './presentation/http/resource.controller.js';
import { ResourceService } from './application/resource.service.js';
import {
  RESOURCE_READER,
  type ResourceReader,
} from './application/resource-read.port.js';
import { PrismaResourceReader } from './infrastructure/prisma-resource-reader.js';
import { DatabaseModule } from '../../infrastructure/database/database.module.js';
import { DatabaseService } from '../../infrastructure/database/database.service.js';
import { M1ControlPlaneService } from './application/m1-control-plane.service.js';
import {
  M1_REPOSITORY,
  type M1Repository,
} from './application/m1-repository.port.js';
import { PrismaM1Repository } from './infrastructure/prisma-m1.repository.js';
import { ControlPlaneController } from './presentation/http/control-plane.controller.js';
import { RUNTIME_CONFIG } from '../../infrastructure/config/runtime-config.module.js';
import type { RuntimeConfig } from '../../infrastructure/config/environment-config.js';
import {
  RUNNER_LIVENESS_REGISTRY,
  type RunnerLivenessRegistry,
} from './application/runner-liveness-registry.port.js';
import {
  RUNNER_PRESENCE_STORE,
  type RunnerPresenceStore,
} from './application/runner-presence-store.port.js';
import { RunnerLivenessService } from './application/runner-liveness.service.js';
import { PrismaRunnerLivenessRegistry } from './infrastructure/prisma-runner-liveness.registry.js';
import { InMemoryRunnerPresenceStore } from './infrastructure/in-memory-runner-presence.store.js';
import { RedisRunnerPresenceStore } from './infrastructure/redis-runner-presence.store.js';
import { UnavailableRunnerPresenceStore } from './infrastructure/runner-presence-proof.js';
import {
  RUNNER_DISPATCH_REPOSITORY,
  type RunnerDispatchRepository,
} from './application/runner-dispatch.port.js';
import { RunnerDispatchService } from './application/runner-dispatch.service.js';
import { PrismaRunnerDispatchRepository } from './infrastructure/prisma-runner-dispatch.repository.js';
import {
  RUNNER_LEASE_STORE,
  type RunnerLeaseStore,
} from './application/runner-lease-store.port.js';
import {
  RUNNER_LEASE_AUTHORITY,
  type RunnerLeaseAuthority,
} from './application/runner-lease-authority.port.js';
import { RunnerLeaseService } from './application/runner-lease.service.js';
import { PrismaRunnerLeaseAuthority } from './infrastructure/prisma-runner-lease.authority.js';
import { InMemoryRunnerLeaseStore } from './infrastructure/in-memory-runner-lease.store.js';
import { RedisRunnerLeaseStore } from './infrastructure/redis-runner-lease.store.js';
import { UnavailableRunnerLeaseStore } from './infrastructure/unavailable-runner-lease.store.js';

@Module({
  imports: [DatabaseModule],
  controllers: [
    ControlPlaneController,
    ResourceController,
    RunnerAuthorityController,
  ],
  providers: [
    {
      provide: RUNNER_AUTHORITY,
      inject: [DatabaseService],
      useFactory: (db: DatabaseService) => new PrismaRunnerAuthority(db),
    },
    {
      provide: RunnerAuthorityService,
      inject: [RUNNER_AUTHORITY, RunnerLeaseService],
      useFactory: (authority: RunnerAuthority, leases: RunnerLeaseService) =>
        new RunnerAuthorityService(authority, leases),
    },
    {
      provide: RUNNER_LIVENESS_REGISTRY,
      inject: [DatabaseService],
      useFactory: (database: DatabaseService) =>
        new PrismaRunnerLivenessRegistry(database),
    },
    {
      provide: RUNNER_PRESENCE_STORE,
      inject: [RUNTIME_CONFIG],
      useFactory: (config: RuntimeConfig) =>
        config.runner.coordinationRedisUrl
          ? RedisRunnerPresenceStore.connect(config.runner.coordinationRedisUrl)
          : config.runtimeMode === 'm0-local'
            ? new InMemoryRunnerPresenceStore()
            : new UnavailableRunnerPresenceStore(),
    },
    {
      provide: RUNNER_LEASE_STORE,
      inject: [RUNTIME_CONFIG],
      useFactory: (config: RuntimeConfig) =>
        config.runner.coordinationRedisUrl
          ? RedisRunnerLeaseStore.connect(config.runner.coordinationRedisUrl)
          : config.runtimeMode === 'm0-local'
            ? new InMemoryRunnerLeaseStore()
            : new UnavailableRunnerLeaseStore(),
    },
    {
      provide: RUNNER_LEASE_AUTHORITY,
      inject: [DatabaseService],
      useFactory: (database: DatabaseService) =>
        new PrismaRunnerLeaseAuthority(database),
    },
    {
      provide: RunnerLeaseService,
      inject: [
        RUNNER_LIVENESS_REGISTRY,
        RUNNER_PRESENCE_STORE,
        RUNNER_LEASE_STORE,
        RUNNER_LEASE_AUTHORITY,
      ],
      useFactory: (
        registry: RunnerLivenessRegistry,
        presence: RunnerPresenceStore,
        leases: RunnerLeaseStore,
        authority: RunnerLeaseAuthority,
      ) => new RunnerLeaseService(registry, presence, leases, authority),
    },
    {
      provide: RunnerLivenessService,
      inject: [RUNNER_LIVENESS_REGISTRY, RUNNER_PRESENCE_STORE],
      useFactory: (
        registry: RunnerLivenessRegistry,
        presence: RunnerPresenceStore,
      ) => new RunnerLivenessService(registry, presence),
    },
    {
      provide: RUNNER_DISPATCH_REPOSITORY,
      inject: [DatabaseService],
      useFactory: (database: DatabaseService) =>
        new PrismaRunnerDispatchRepository(database),
    },
    {
      provide: RunnerDispatchService,
      inject: [
        RUNNER_LIVENESS_REGISTRY,
        RUNNER_PRESENCE_STORE,
        RUNNER_DISPATCH_REPOSITORY,
      ],
      useFactory: (
        registry: RunnerLivenessRegistry,
        presence: RunnerPresenceStore,
        repository: RunnerDispatchRepository,
      ) => new RunnerDispatchService(registry, presence, repository),
    },
    {
      provide: RESOURCE_READER,
      inject: [DatabaseService],
      useFactory: (db: DatabaseService) => new PrismaResourceReader(db),
    },
    {
      provide: ResourceService,
      inject: [RESOURCE_READER, M1_REPOSITORY],
      useFactory: (reader: ResourceReader, repo: M1Repository) =>
        new ResourceService(reader, repo),
    },
    {
      provide: M1_REPOSITORY,
      inject: [DatabaseService],
      useFactory: (database: DatabaseService) =>
        new PrismaM1Repository(database),
    },
    {
      provide: M1ControlPlaneService,
      inject: [M1_REPOSITORY],
      useFactory: (repository: M1Repository) =>
        new M1ControlPlaneService(repository),
    },
  ],
  exports: [M1ControlPlaneService, M1_REPOSITORY],
})
export class ControlPlaneModule {}
