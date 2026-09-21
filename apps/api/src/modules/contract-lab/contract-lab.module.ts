import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module.js';
import { DatabaseService } from '../../infrastructure/database/database.service.js';
import { loadContractDocument } from '../../infrastructure/config/contract-document.js';
import { CONTRACT_DOCUMENT } from './application/ports/catalog-document.port.js';
import { ValidateContractUseCase } from './application/validate-contract.use-case.js';
import { ReadHistoryUseCase } from './application/read-history.use-case.js';
import { GetLabHealthUseCase } from './application/get-lab-health.use-case.js';
import {
  CONTRACT_POLICY,
  PROFILE_READER,
  DATABASE_PROBE,
  type ContractPolicy,
  type ProfileReader,
  type DatabaseProbe,
} from './application/ports/contract-policy.port.js';
import {
  VALIDATION_REPOSITORY,
  type ValidationRepository,
} from './application/ports/validation-repository.port.js';
import { PrismaValidationRepository } from './infrastructure/prisma-validation.repository.js';
import { PrismaProfileReader } from './infrastructure/prisma-profile-reader.js';
import { ZodContractPolicy } from './infrastructure/zod-contract-policy.js';
import { ValidationsController } from './presentation/http/validations.controller.js';
import { HistoryController } from './presentation/http/history.controller.js';
import { HealthController } from './presentation/http/health.controller.js';
import { CatalogController } from './presentation/http/catalog.controller.js';

@Module({
  imports: [DatabaseModule],
  controllers: [
    ValidationsController,
    HistoryController,
    HealthController,
    CatalogController,
  ],
  providers: [
    { provide: CONTRACT_DOCUMENT, useFactory: loadContractDocument },
    { provide: CONTRACT_POLICY, useClass: ZodContractPolicy },
    {
      provide: PROFILE_READER,
      inject: [DatabaseService],
      useFactory: (database: DatabaseService) =>
        new PrismaProfileReader(database),
    },
    {
      provide: VALIDATION_REPOSITORY,
      inject: [DatabaseService],
      useFactory: (database: DatabaseService) =>
        new PrismaValidationRepository(database),
    },
    {
      provide: DATABASE_PROBE,
      inject: [DatabaseService],
      useFactory: (database: DatabaseService): DatabaseProbe => ({
        check: () => database.check(),
      }),
    },
    {
      provide: ValidateContractUseCase,
      inject: [VALIDATION_REPOSITORY, PROFILE_READER, CONTRACT_POLICY],
      useFactory: (
        records: ValidationRepository,
        profiles: ProfileReader,
        policy: ContractPolicy,
      ) => new ValidateContractUseCase(records, profiles, policy),
    },
    {
      provide: ReadHistoryUseCase,
      inject: [VALIDATION_REPOSITORY],
      useFactory: (records: ValidationRepository) =>
        new ReadHistoryUseCase(records),
    },
    {
      provide: GetLabHealthUseCase,
      inject: [DATABASE_PROBE, VALIDATION_REPOSITORY],
      useFactory: (probe: DatabaseProbe, records: ValidationRepository) =>
        new GetLabHealthUseCase(probe, records),
    },
  ],
})
export class ContractLabModule {}
