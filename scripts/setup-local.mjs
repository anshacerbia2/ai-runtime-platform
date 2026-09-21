import { existsSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { resolve, dirname, join, isAbsolute } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import net from 'node:net';
import pg from 'pg';
import { loadEnvironment, projectRoot } from '../config/environment.mjs';

const config = loadEnvironment();
const ext = process.platform === 'win32' ? '.exe' : '';
const log = (message) => console.log(`[M0 setup] ${message}`);
const projectPath = (value) =>
  isAbsolute(value) ? value : resolve(projectRoot, value);
const dataDir = projectPath(config.database.dataDir);
const logFile = projectPath(config.database.logFile);
const pgCtl = join(config.database.pgBin, `pg_ctl${ext}`);

async function assertPortFree(host, port) {
  await new Promise((resolvePort, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(port, host, () => server.close(resolvePort));
  });
}

function postgresStatus() {
  return spawnSync(pgCtl, ['status', '-D', dataDir]).status === 0;
}
try {
  if (process.argv.includes('--stop')) {
    if (!config.database.managePostgres) {
      log(
        'M0_MANAGE_POSTGRES=false; no database process is managed by this repo.',
      );
      process.exit(0);
    }
    if (postgresStatus()) {
      execFileSync(pgCtl, ['stop', '-D', dataDir, '-m', 'fast', '-w'], {
        stdio: 'inherit',
      });
    }
    log(
      'Only the env-declared project PostgreSQL cluster was stopped; data retained.',
    );
    process.exit(0);
  }

  if (config.database.managePostgres) {
    mkdirSync(dirname(dataDir), { recursive: true });
    mkdirSync(dirname(logFile), { recursive: true });
    if (!existsSync(join(dataDir, 'PG_VERSION'))) {
      if (existsSync(dataDir)) {
        throw new Error(
          `Partial database directory found at ${dataDir}; inspect manually. No automatic deletion.`,
        );
      }
      const passwordFile = resolve(dirname(dataDir), 'initdb-password.tmp');
      writeFileSync(passwordFile, `${config.database.password}\n`, {
        mode: 0o600,
        flag: 'wx',
      });
      try {
        execFileSync(
          join(config.database.pgBin, `initdb${ext}`),
          [
            '-D',
            dataDir,
            '-U',
            config.database.user,
            '--auth=scram-sha-256',
            '--encoding=UTF8',
            '--locale=C',
            `--pwfile=${passwordFile}`,
          ],
          { stdio: 'inherit' },
        );
      } finally {
        unlinkSync(passwordFile);
      }
    }

    if (!postgresStatus()) {
      await assertPortFree(config.database.host, config.database.port);
      execFileSync(
        pgCtl,
        [
          'start',
          '-D',
          dataDir,
          '-l',
          logFile,
          '-o',
          `-h ${config.database.host} -p ${config.database.port}`,
          '-w',
          '-t',
          String(config.dev.postgresStartTimeoutSeconds),
        ],
        { stdio: 'inherit' },
      );
    }
    const adminUrl = new URL(config.databaseUrl);
    adminUrl.pathname = '/postgres';
    adminUrl.search = '';
    const admin = new pg.Client({
      connectionString: adminUrl.toString(),
      connectionTimeoutMillis: config.database.connectionTimeoutMs,
    });
    await admin.connect();
    try {
      const check = await admin.query(
        'SELECT 1 FROM pg_database WHERE datname=$1',
        [config.database.name],
      );
      if (!check.rows.length) {
        if (config.database.name !== 'ai_runtime_m0') {
          throw new Error('Unexpected M0 database name.');
        }
        await admin.query('CREATE DATABASE ai_runtime_m0');
      }
    } finally {
      await admin.end();
    }
  }

  const client = new pg.Client({
    connectionString: config.databaseUrl,
    connectionTimeoutMillis: config.database.connectionTimeoutMs,
  });
  await client.connect();
  const version = await client.query('SHOW server_version');
  await client.end();
  log(
    `PostgreSQL ${version.rows[0].server_version} reachable at ${config.database.host}:${config.database.port}. Secrets are not printed.`,
  );
  if (!process.argv.includes('--db-only')) {
    execFileSync(
      process.execPath,
      [join(projectRoot, 'scripts/database/migrate.mjs')],
      {
        cwd: projectRoot,
        stdio: 'inherit',
      },
    );
  }
  log(
    `Ready. Configuration authority: environment/.env. Data: ${config.database.dataDir}.`,
  );
} catch (error) {
  console.error(
    '[M0 setup failed]',
    error instanceof Error ? error.message : String(error),
  );
  process.exitCode = 1;
}
