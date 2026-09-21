import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/client.js';

export function databaseOptions(databaseUrl: string) {
  return {
    adapter: new PrismaPg({
      connectionString: databaseUrl,
      max: 6,
      connectionTimeoutMillis: 3000,
      idleTimeoutMillis: 10000,
      statement_timeout: 5000,
      application_name: 'ai-runtime-m0-prisma',
    }),
  };
}

/** CLI/tests own and close their clients; API uses one injected singleton. */
export function createDatabaseClient(databaseUrl: string) {
  return new PrismaClient(databaseOptions(databaseUrl));
}
