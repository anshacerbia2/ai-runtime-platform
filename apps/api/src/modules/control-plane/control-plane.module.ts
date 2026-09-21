import { Module } from '@nestjs/common';
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
  controllers: [ControlPlaneController],
  providers: [
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
})
export class ControlPlaneModule {}
