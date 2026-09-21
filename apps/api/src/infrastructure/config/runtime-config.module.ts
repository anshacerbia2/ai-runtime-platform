import { Global, Module, type DynamicModule } from '@nestjs/common';
import type { RuntimeConfig } from './environment-config.js';

export const RUNTIME_CONFIG = Symbol('RuntimeConfiguration');

@Global()
@Module({})
export class RuntimeConfigModule {
  static register(config: RuntimeConfig): DynamicModule {
    return {
      module: RuntimeConfigModule,
      providers: [{ provide: RUNTIME_CONFIG, useValue: Object.freeze(config) }],
      exports: [RUNTIME_CONFIG],
    };
  }
}
