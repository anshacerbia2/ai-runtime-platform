import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  // Generate/format are offline. Migration scripts pass a validated local URL.
  datasource: {
    url:
      process.env.DATABASE_URL ??
      'postgresql://unused:unused@127.0.0.1:54329/ai_runtime_m0?schema=m0',
  },
});
