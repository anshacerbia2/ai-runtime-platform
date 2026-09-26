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
      inject: [RUNNER_AUTHORITY],
      useFactory: (authority: RunnerAuthority) =>
        new RunnerAuthorityService(authority),
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
