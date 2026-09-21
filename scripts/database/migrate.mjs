import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import pg from 'pg';
import { loadEnvironment, projectRoot } from '../../config/environment.mjs';

const config = loadEnvironment();
const prismaCli = resolve(projectRoot, 'node_modules/prisma/build/index.js');

function prisma(args, capture = false) {
  const result = spawnSync(process.execPath, [prismaCli, ...args], {
    cwd: projectRoot,
    env: process.env,
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
// Legacy compatibility is a one-time, guarded tooling concern.
const client = new pg.Client({
  connectionString: config.databaseUrl,
  connectionTimeoutMillis: config.database.connectionTimeoutMs,
});
await client.connect();
try {
  const state = await client.query(`SELECT
    to_regclass('m0.applications') IS NOT NULL AS existing,
    to_regclass('m0._prisma_migrations') IS NOT NULL AS managed`);
  if (state.rows[0].existing && !state.rows[0].managed) {
    const legacySql = readFileSync(
      resolve(projectRoot, 'db/migrations/0001_m0_contract_lab.sql'),
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
  [
    resolve(projectRoot, 'node_modules/tsx/dist/cli.mjs'),
    'apps/api/src/cli/seed.ts',
  ],
  {
    cwd: projectRoot,
    env: process.env,
    stdio: 'inherit',
  },
);
if (seed.status !== 0) {
  throw new Error('Seed failed; existing history is not deleted.');
}
