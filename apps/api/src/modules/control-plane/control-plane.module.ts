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
import {
  RUNNER_LEASE_RECOVERY,
  type RunnerLeaseRecovery,
} from './application/runner-lease-recovery.port.js';
import { RunnerLeaseRecoveryService } from './application/runner-lease-recovery.service.js';
import { PrismaRunnerLeaseRecoveryRepository } from './infrastructure/prisma-runner-lease-recovery.repository.js';
import { RunnerLeaseRecoveryWorker } from './infrastructure/runner-lease-recovery.worker.js';
import { RunnerCoordinationService } from './application/runner-coordination.service.js';
import type { RunnerCoordinationStore } from './application/runner-coordination.port.js';
import { PrismaRunnerCoordinationRepository } from './infrastructure/prisma-runner-coordination.repository.js';
import { RedisRunnerCoordinationStore } from './infrastructure/redis-runner-coordination.store.js';

const RUNNER_COORDINATION_STORE = Symbol('RUNNER_COORDINATION_STORE');

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
      inject: [DatabaseService, RUNTIME_CONFIG],
      useFactory: (db: DatabaseService, config: RuntimeConfig) =>
        new PrismaRunnerAuthority(db, config.runtimeMode !== 'm0-local'),
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
      inject: [DatabaseService, RUNTIME_CONFIG],
      useFactory: (database: DatabaseService, config: RuntimeConfig) =>
        new PrismaRunnerLeaseAuthority(
          database,
          config.runtimeMode !== 'm0-local',
        ),
    },
    {
      provide: RUNNER_LEASE_RECOVERY,
      inject: [DatabaseService],
      useFactory: (database: DatabaseService) =>
        new PrismaRunnerLeaseRecoveryRepository(database),
    },
    {
      provide: RUNNER_COORDINATION_STORE,
      inject: [RUNTIME_CONFIG],
      useFactory: (config: RuntimeConfig) =>
        config.runtimeMode === 'm0-local'
          ? null
          : RedisRunnerCoordinationStore.connect(
              config.runner.coordinationRedisUrl!,
            ),
    },
    {
      provide: RunnerCoordinationService,
      inject: [
        DatabaseService,
        RUNNER_LEASE_RECOVERY,
        RUNNER_COORDINATION_STORE,
      ],
      useFactory: (
        database: DatabaseService,
        recovery: RunnerLeaseRecovery,
        store: RunnerCoordinationStore | null,
      ) =>
        new RunnerCoordinationService(
          new PrismaRunnerCoordinationRepository(database),
          recovery,
          store,
        ),
    },
    {
      provide: RunnerLeaseRecoveryService,
      inject: [RUNNER_LEASE_RECOVERY, RUNNER_LEASE_STORE],
      useFactory: (repository: RunnerLeaseRecovery, leases: RunnerLeaseStore) =>
        new RunnerLeaseRecoveryService(repository, leases),
    },
    RunnerLeaseRecoveryWorker,
    {
      provide: RunnerLeaseService,
      inject: [
        RUNNER_LIVENESS_REGISTRY,
        RUNNER_PRESENCE_STORE,
        RUNNER_LEASE_STORE,
        RUNNER_LEASE_AUTHORITY,
        RunnerCoordinationService,
      ],
      useFactory: (
        registry: RunnerLivenessRegistry,
        presence: RunnerPresenceStore,
        leases: RunnerLeaseStore,
        authority: RunnerLeaseAuthority,
        coordination: RunnerCoordinationService,
      ) =>
        new RunnerLeaseService(
          registry,
          presence,
          leases,
          authority,
          coordination,
        ),
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
      inject: [DatabaseService, RUNTIME_CONFIG],
      useFactory: (database: DatabaseService, config: RuntimeConfig) =>
        new PrismaRunnerDispatchRepository(
          database,
          config.runtimeMode !== 'm0-local',
        ),
    },
    {
      provide: RunnerDispatchService,
      inject: [
        RUNNER_LIVENESS_REGISTRY,
        RUNNER_PRESENCE_STORE,
        RUNNER_DISPATCH_REPOSITORY,
        RunnerCoordinationService,
      ],
      useFactory: (
        registry: RunnerLivenessRegistry,
        presence: RunnerPresenceStore,
        repository: RunnerDispatchRepository,
        coordination: RunnerCoordinationService,
      ) =>
        new RunnerDispatchService(registry, presence, repository, coordination),
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
