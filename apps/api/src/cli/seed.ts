import { loadConfig } from '../infrastructure/config/local-config.js';
import { createDatabaseClient } from '../infrastructure/database/client.js';
import { seedDatabase } from '../infrastructure/database/seed.js';

const config = loadConfig();
const database = createDatabaseClient(config.databaseUrl);
try {
  await seedDatabase(database, config);
  console.log('M0 Prisma seed complete. Existing validation history retained.');
} finally {
  await database.$disconnect();
}
