import {
  Inject,
  Injectable,
  type OnModuleInit,
  type OnModuleDestroy,
} from '@nestjs/common';
import { RUNTIME_CONFIG } from '../config/runtime-config.module.js';
import type { RuntimeConfig } from '../config/environment-config.js';
import { PrismaClient } from './generated/client.js';
import { databaseOptions } from './client.js';

@Injectable()
export class DatabaseService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor(@Inject(RUNTIME_CONFIG) config: RuntimeConfig) {
    super(databaseOptions(config));
  }

  async check() {
    await this.$queryRaw`SELECT 1`;
  }

  async onModuleInit() {
    await this.$connect();
  }
  async onModuleDestroy() {
    await this.$disconnect();
  }
}
