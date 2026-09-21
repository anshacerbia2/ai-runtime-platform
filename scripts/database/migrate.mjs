import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import pg from 'pg';

const root = process.cwd();
const config = JSON.parse(
  readFileSync(resolve(root, '.local/config.json'), 'utf8'),
);
const url = new URL(config.databaseUrl);
if (
  config.owner !== 'ai-runtime-platform-m0' ||
  !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
  url.pathname !== '/ai_runtime_m0' ||
  process.env.NODE_ENV === 'production'
) {
  throw new Error(
    'Refusing migration outside the dedicated local M0 database.',
  );
}
url.searchParams.set('schema', 'm0');
const environment = { ...process.env, DATABASE_URL: url.toString() };
const prismaCli = resolve(root, 'node_modules/prisma/build/index.js');

function prisma(args, capture = false) {
  const result = spawnSync(process.execPath, [prismaCli, ...args], {
    cwd: root,
    env: environment,
    encoding: 'utf8',
    stdio: capture ? 'pipe' : 'inherit',
  });
  if (result.status !== 0) {
    throw new Error(
      `Prisma ${args.slice(0, 2).join(' ')} failed. No reset attempted. ${capture ? result.stdout + result.stderr : ''}`,
    );
  }
  return result.stdout ?? '';
}

// Legacy compatibility is a one-time, guarded tooling concern. The HTTP runtime
// does not import pg, execute migrations, or use the superuser to alter schemas.
const client = new pg.Client({
  connectionString: config.databaseUrl,
  connectionTimeoutMillis: 3000,
});
await client.connect();
try {
  const state = await client.query(`SELECT
    to_regclass('m0.applications') IS NOT NULL AS existing,
    to_regclass('m0._prisma_migrations') IS NOT NULL AS managed`);
  if (state.rows[0].existing && !state.rows[0].managed) {
    const legacySql = readFileSync(
      resolve(root, 'db/migrations/0001_m0_contract_lab.sql'),
    );
    const checksum = createHash('sha256').update(legacySql).digest('hex');
    const legacy = await client.query(
      'SELECT checksum FROM m0.schema_migrations WHERE version=$1',
      ['0001'],
    );
    if (legacy.rows[0]?.checksum !== checksum) {
      throw new Error(
        'Legacy schema checksum mismatch; inspect before baselining. No reset attempted.',
      );
    }
    // Exit code 2 means schema drift. Fail closed instead of marking an arbitrary
    // existing database as migrated. Custom CHECK constraints stay in baseline SQL.
    prisma(
      [
        'migrate',
        'diff',
        '--from-config-datasource',
        '--to-schema',
        'prisma/schema.prisma',
        '--exit-code',
      ],
      true,
    );
    prisma(['migrate', 'resolve', '--applied', '0001_baseline']);
  }
} finally {
  await client.end();
}
prisma(['migrate', 'deploy']);
const seed = spawnSync(
  process.execPath,
  [resolve(root, 'node_modules/tsx/dist/cli.mjs'), 'apps/api/src/cli/seed.ts'],
  {
    cwd: root,
    env: environment,
    stdio: 'inherit',
  },
);
if (seed.status !== 0) {
  throw new Error('Seed failed; existing history is not deleted.');
}
