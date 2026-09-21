import { loadConfig } from '../infrastructure/config/local-config.js';
import { createDatabaseClient } from '../infrastructure/database/client.js';

const database = createDatabaseClient(loadConfig().databaseUrl);
try {
  console.table(
    await database.contractCheck.groupBy({
      by: ['applicationId', 'kind', 'valid'],
      _count: { _all: true },
    }),
  );
  console.table(
    await database.contractCheck.findMany({
      take: 10,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        applicationId: true,
        kind: true,
        valid: true,
        createdAt: true,
      },
    }),
  );
  console.log(
    'Prisma queries return metadata only. Credentials and raw prompts are not displayed.',
  );
} finally {
  await database.$disconnect();
}
