import { Module, type DynamicModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { RuntimeConfigModule } from './infrastructure/config/runtime-config.module.js';
import type { RuntimeConfig } from './infrastructure/config/environment-config.js';
import { IdentityModule } from './modules/identity/identity.module.js';
import { LocalAuthGuard } from './modules/identity/presentation/http/local-auth.guard.js';
import { ContractLabModule } from './modules/contract-lab/contract-lab.module.js';
import { HttpExceptionFilter } from './shared/presentation/http-exception.filter.js';

@Module({})
export class AppModule {
  static register(config: RuntimeConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        RuntimeConfigModule.register(config),
        IdentityModule,
        ContractLabModule,
      ],
      providers: [
        { provide: APP_GUARD, useClass: LocalAuthGuard },
        { provide: APP_FILTER, useClass: HttpExceptionFilter },
      ],
    };
  }
}
