import { defineConfig } from 'prisma/config';
import { loadDatabaseEnvironment } from './config/environment.mjs';

const config = loadDatabaseEnvironment();
const datasourceUrl = new URL(config.databaseUrl);
datasourceUrl.searchParams.set('schema', 'm0');

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: datasourceUrl.toString() },
});
