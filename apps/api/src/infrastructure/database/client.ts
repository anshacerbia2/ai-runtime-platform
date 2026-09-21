import { PrismaPg } from '@prisma/adapter-pg';
import type { RuntimeConfig } from '../config/environment-config.js';
import { PrismaClient } from './generated/client.js';

export function databaseOptions(config: RuntimeConfig) {
  return {
    adapter: new PrismaPg({
      connectionString: config.databaseUrl,
      max: config.database.poolMax,
      connectionTimeoutMillis: config.database.connectionTimeoutMs,
      idleTimeoutMillis: config.database.idleTimeoutMs,
      statement_timeout: config.database.statementTimeoutMs,
      application_name: config.database.applicationName,
    }),
  };
}

/** CLI/tests own and close their clients; API uses one injected singleton. */
export function createDatabaseClient(config: RuntimeConfig) {
  return new PrismaClient(databaseOptions(config));
}
