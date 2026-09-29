// Local, repository-level PostgreSQL admission load probe. No provider calls.
// Run after building the API: npm run benchmark:admission
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { loadConfig } from '../apps/api/dist/infrastructure/config/environment-config.js';
import { PrismaClient } from '../apps/api/dist/infrastructure/database/generated/client.js';
import { PrismaM1Repository } from '../apps/api/dist/modules/control-plane/infrastructure/prisma-m1.repository.js';
import { M1ControlPlaneService } from '../apps/api/dist/modules/control-plane/application/m1-control-plane.service.js';

const config = loadConfig();
if (config.runtimeMode !== 'm0-local') {
  throw new Error(
    'Admission benchmark only runs against the loopback local database.',
  );
}

const runId = randomUUID();
const prefix = `admit-bench-${runId}`;
const appName = `admit-bench-${runId.slice(0, 8)}`;
const poolWaitMs = [];
const advisoryStatementMs = [];
const policyLockStatementMs = [];
const capacityStatementMs = [];
const rateWindowStatementMs = [];
const budgetLockStatementMs = [];
let transactionStarts = 0;
const instrumented = new WeakSet();
const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: config.database.poolMax,
  connectionTimeoutMillis: config.database.connectionTimeoutMs,
  idleTimeoutMillis: config.database.idleTimeoutMs,
  statement_timeout: config.database.statementTimeoutMs,
  application_name: appName,
});
const observer = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 1,
  application_name: `${appName}-observer`,
});

function instrumentClient(client) {
  if (instrumented.has(client)) {
    return;
  }
  instrumented.add(client);
  const originalQuery = client.query.bind(client);
  client.query = (...args) => {
    const sql = typeof args[0] === 'string' ? args[0] : args[0]?.text;
    if (/^BEGIN$/i.test(sql?.trim() ?? '')) {
      transactionStarts++;
    }
    const samples = /pg_advisory_xact_lock/i.test(sql ?? '')
      ? advisoryStatementMs
      : /FROM control\.(applications|ai_connections|credential_bindings|profile_aliases)[\s\S]*FOR SHARE/i.test(
            sql ?? '',
          )
        ? policyLockStatementMs
        : /SELECT count\(\*\)::bigint AS count[\s\S]*FROM control\.executions/i.test(
              sql ?? '',
            )
          ? capacityStatementMs
          : /INSERT INTO control\.admission_rate_windows/i.test(sql ?? '')
            ? rateWindowStatementMs
            : /FROM control\.budget_accounts WHERE id = .*FOR UPDATE/i.test(
                  sql ?? '',
                )
              ? budgetLockStatementMs
              : null;
    if (!samples) {
      return originalQuery(...args);
    }
    const started = performance.now();
    const callbackIndex = args.findIndex((arg) => typeof arg === 'function');
    if (callbackIndex >= 0) {
      const callback = args[callbackIndex];
      args[callbackIndex] = (...values) => {
        samples.push(performance.now() - started);
        callback(...values);
      };
      return originalQuery(...args);
    }
    const result = originalQuery(...args);
    return result.finally(() => samples.push(performance.now() - started));
  };
}

const originalConnect = pool.connect.bind(pool);
pool.connect = (callback) => {
  const started = performance.now();
  if (typeof callback === 'function') {
    return originalConnect((error, client, release) => {
      poolWaitMs.push(performance.now() - started);
      if (client) {
        instrumentClient(client);
      }
      callback(error, client, release);
    });
  }
  return originalConnect().then(
    (client) => {
      poolWaitMs.push(performance.now() - started);
      instrumentClient(client);
      return client;
    },
    (error) => {
      poolWaitMs.push(performance.now() - started);
      throw error;
    },
  );
};

const db = new PrismaClient({ adapter: new PrismaPg(pool) });
const control = new M1ControlPlaneService(new PrismaM1Repository(db));

function summary(values) {
  if (!values.length) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = (percent) =>
    sorted[Math.ceil(percent * sorted.length) - 1];
  return {
    count: sorted.length,
    min: sorted[0],
    mean: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
    p50: percentile(0.5),
    p95: percentile(0.95),
    p99: percentile(0.99),
    max: sorted.at(-1),
  };
}

async function fixture(label) {
  const id = `${prefix}-${label}`;
  const applicationId = `${id}-app`;
  const connectionId = `${id}-connection`;
  const accountId = `${id}-account`;
  const profileRef = `${id}-profile`;
  const data = { applicationId, connectionId, accountId, profileRef };
  try {
    await db.controlApplication.create({
      data: {
        id: applicationId,
        displayName: 'Disposable admission benchmark',
        environment: 'local',
        keycloakClientId: `${id}-client`,
        gatewayMaxConcurrency: 10_000,
        gatewayRequestsPerMinute: 10_000,
      },
    });
    await db.aiConnection.create({
      data: {
        id: connectionId,
        displayName: 'Disposable admission benchmark',
        provider: 'fixture',
        authMode: 'API_KEY',
        environment: 'local',
        sharingMode: 'DEDICATED',
        quotaGroupRef: null,
        gatewayMaxConcurrency: 10_000,
        gatewayRequestsPerMinute: 10_000,
      },
    });
    await db.credentialBinding.create({
      data: {
        id: randomUUID(),
        applicationId,
        connectionId,
        profileRef: null,
      },
    });
    await db.budgetAccount.create({
      data: {
        id: accountId,
        applicationId,
        quotaGroupRef: null,
        unit: 'benchmark-units',
        period: 'one-run',
        limitUnits: 10_000n,
      },
    });
    await db.profileRevision.create({
      data: {
        id: randomUUID(),
        applicationId,
        profileRef,
        revision: 1,
        connectionId,
        capability: 'chat',
        providerAdapter: 'fixture',
        model: 'fixture',
        holdUnits: 1n,
        accountIds: [accountId],
        digest: 'a'.repeat(64),
      },
    });
    await db.profileAlias.create({
      data: { applicationId, profileRef, revision: 1 },
    });
    return data;
  } catch (error) {
    await cleanupFixture(data);
    throw error;
  }
}

async function cleanupFixture({
  applicationId,
  connectionId,
  accountId,
  profileRef,
}) {
  const executions = await db.execution.findMany({
    where: { applicationId },
    select: { id: true },
  });
  const ids = executions.map((execution) => execution.id);
  await db.outboxEvent.deleteMany({ where: { applicationId } });
  await db.reservation.deleteMany({ where: { executionId: { in: ids } } });
  await db.attempt.deleteMany({ where: { executionId: { in: ids } } });
  await db.execution.deleteMany({ where: { applicationId } });
  await db.admissionRateWindow.deleteMany({
    where: {
      scopeKey: {
        in: [`application:${applicationId}`, `connection:${connectionId}`],
      },
    },
  });
  await db.profileAlias.deleteMany({ where: { applicationId, profileRef } });
  await db.profileRevision.deleteMany({ where: { applicationId, profileRef } });
  await db.budgetAccount.deleteMany({ where: { id: accountId } });
  await db.credentialBinding.deleteMany({
    where: { applicationId, connectionId },
  });
  await db.aiConnection.deleteMany({ where: { id: connectionId } });
  await db.controlApplication.deleteMany({ where: { id: applicationId } });
}

async function runScenario(concurrency, requests, shards) {
  const label = `c${concurrency}s${shards}`;
  const fixtures = [];
  try {
    for (let index = 0; index < shards; index++) {
      fixtures.push(await fixture(`${label}-${index}`));
    }
  } catch (error) {
    for (const data of fixtures) {
      await cleanupFixture(data);
    }
    throw error;
  }
  const workloads = fixtures.map((data) => ({
    principal: {
      subject: data.applicationId,
      kind: 'application',
      applicationId: data.applicationId,
      roles: ['runtime-application'],
      scopes: ['execution:submit'],
    },
    command: { profileRef: data.profileRef, inputDigest: 'b'.repeat(64) },
  }));
  const latencies = [];
  const failures = [];
  const activity = {
    samples: 0,
    lockWaiterSamples: 0,
    oldestLockQueryMs: [],
    waitEvents: {},
    maxPoolWaiting: 0,
  };
  let observing = true;
  const monitor = (async () => {
    while (observing) {
      activity.samples++;
      activity.maxPoolWaiting = Math.max(
        activity.maxPoolWaiting,
        pool.waitingCount,
      );
      try {
        const { rows } = await observer.query(
          `SELECT wait_event_type, wait_event,
                  EXTRACT(EPOCH FROM clock_timestamp() - query_start) * 1000 AS query_age_ms
             FROM pg_stat_activity WHERE application_name = $1 AND state = 'active'`,
          [appName],
        );
        for (const row of rows) {
          if (row.wait_event_type === 'Lock') {
            activity.lockWaiterSamples++;
            activity.oldestLockQueryMs.push(Number(row.query_age_ms));
            const event = row.wait_event ?? 'unknown';
            activity.waitEvents[event] = (activity.waitEvents[event] ?? 0) + 1;
          }
        }
      } catch (error) {
        activity.monitorError = error.message;
        observing = false;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  })();
  const before = {
    pool: poolWaitMs.length,
    advisory: advisoryStatementMs.length,
    policy: policyLockStatementMs.length,
    capacity: capacityStatementMs.length,
    rate: rateWindowStatementMs.length,
    budget: budgetLockStatementMs.length,
    transactions: transactionStarts,
  };
  const started = performance.now();
  let elapsedMs;
  let measured;
  let next = 0;
  try {
    await Promise.all(
      Array.from({ length: concurrency }, async () => {
        for (;;) {
          const index = next++;
          if (index >= requests) {
            return;
          }
          const requestStarted = performance.now();
          try {
            const workload = workloads[index % shards];
            await control.admit(
              workload.principal,
              workload.command,
              `${label}-${index}`,
            );
            latencies.push(performance.now() - requestStarted);
          } catch (error) {
            failures.push({
              code: error.code ?? error.name,
              message: error.message,
            });
          }
        }
      }),
    );
    elapsedMs = performance.now() - started;
    measured = {
      poolAcquireMs: poolWaitMs.slice(before.pool),
      advisoryStatementMs: advisoryStatementMs.slice(before.advisory),
      policyLockStatementMs: policyLockStatementMs.slice(before.policy),
      capacityStatementMs: capacityStatementMs.slice(before.capacity),
      rateWindowStatementMs: rateWindowStatementMs.slice(before.rate),
      budgetLockStatementMs: budgetLockStatementMs.slice(before.budget),
      transactionStarts: transactionStarts - before.transactions,
    };
  } finally {
    observing = false;
    await monitor;
    for (const data of fixtures) {
      await cleanupFixture(data);
    }
  }
  return {
    concurrency,
    requests,
    shards,
    accepted: latencies.length,
    failures,
    elapsedMs,
    transactionStarts: measured.transactionStarts,
    admissionMs: summary(latencies),
    poolAcquireMs: summary(measured.poolAcquireMs),
    advisoryStatementMs: summary(measured.advisoryStatementMs),
    policyLockStatementMs: summary(measured.policyLockStatementMs),
    capacityStatementMs: summary(measured.capacityStatementMs),
    rateWindowStatementMs: summary(measured.rateWindowStatementMs),
    budgetLockStatementMs: summary(measured.budgetLockStatementMs),
    postgresWaitSamples: {
      ...activity,
      oldestLockQueryMs: summary(activity.oldestLockQueryMs),
    },
    raw: {
      admissionMs: latencies,
      poolAcquireMs: measured.poolAcquireMs,
      advisoryStatementMs: measured.advisoryStatementMs,
      policyLockStatementMs: measured.policyLockStatementMs,
      capacityStatementMs: measured.capacityStatementMs,
      rateWindowStatementMs: measured.rateWindowStatementMs,
      budgetLockStatementMs: measured.budgetLockStatementMs,
    },
  };
}

const outputPath = fileURLToPath(
  new URL(`../.local/admission-benchmark-${runId}.json`, import.meta.url),
);
try {
  const repositoryCode = await readFile(
    new URL(
      '../apps/api/dist/modules/control-plane/infrastructure/prisma-m1.repository.js',
      import.meta.url,
    ),
    'utf8',
  );
  const isolationMatches = [
    ...repositoryCode.matchAll(/isolationLevel: '([^']+)'/g),
  ];
  const { rows: versionRows } = await observer.query(
    "SELECT current_setting('server_version') AS version",
  );
  const evidence = {
    kind: 'local-prisma-admission-benchmark',
    measuredAt: new Date().toISOString(),
    node: process.version,
    postgres: versionRows[0]?.version,
    admissionIsolation: isolationMatches.at(-1)?.[1] ?? 'unknown',
    repositorySha256: createHash('sha256').update(repositoryCode).digest('hex'),
    poolMax: config.database.poolMax,
    statementTimeoutMs: config.database.statementTimeoutMs,
    scope:
      'M1 repository admission, dedicated connection, one budget account; excludes HTTP/provider/Redis',
    caveats: [
      'poolAcquireMs includes connection acquisition overhead as well as queue time',
      'advisoryStatementMs and budgetLockStatementMs include query execution and round trip, not only lock wait',
      'policy, capacity and rate-window statement timings include query execution and round trip',
      'pg_stat_activity wait events are 10ms samples and may miss short waits',
      'transactionStarts counts BEGIN statements; it is not an error-code breakdown',
      'single local workstation and database; not a production capacity or SLO result',
    ],
    scenarios: [],
  };
  for (const [concurrency, shards] of [
    [1, 1],
    [8, 1],
    [24, 1],
    [8, 8],
    [24, 8],
  ]) {
    const result = await runScenario(concurrency, 100, shards);
    evidence.scenarios.push(result);
    console.log(
      `c=${concurrency} shards=${shards} accepted=${result.accepted}/100 p95=${result.admissionMs?.p95?.toFixed(1)}ms p99=${result.admissionMs?.p99?.toFixed(1)}ms pool-p95=${result.poolAcquireMs?.p95?.toFixed(1)}ms tx=${result.transactionStarts} lock-samples=${result.postgresWaitSamples.lockWaiterSamples}`,
    );
  }
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(evidence, null, 2) + '\n');
  console.log(`Raw local evidence: ${outputPath}`);
  if (evidence.scenarios.some((scenario) => scenario.failures.length)) {
    process.exitCode = 1;
  }
} finally {
  await db.$disconnect();
  await pool.end();
  await observer.end();
}
