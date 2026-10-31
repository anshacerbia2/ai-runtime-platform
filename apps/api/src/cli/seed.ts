import { loadConfig } from '../infrastructure/config/environment-config.js';
import { createDatabaseClient } from '../infrastructure/database/client.js';
import { seedDatabase } from '../infrastructure/database/seed.js';
import {
  playgroundProfileRef,
  playgroundProvisioning,
} from '../infrastructure/database/local-playground.seed.js';

const config = loadConfig();
const database = createDatabaseClient(config);
try {
  await seedDatabase(database, config, { playground: true });
  console.log('M0 Prisma seed complete. Existing validation history retained.');
  const playground = playgroundProvisioning(config);
  console.log(
    playground
      ? `Playground: profile "${playgroundProfileRef}" -> ${playground.provider} ${playground.model}.`
      : 'Playground: set M2_ANTHROPIC_API_KEY or M2_OPENROUTER_API_KEY in .env, then rerun npm run db:migrate.',
  );
} finally {
  await database.$disconnect();
}
