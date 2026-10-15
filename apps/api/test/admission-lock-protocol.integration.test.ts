import { randomUUID } from 'node:crypto';
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { loadConfig } from '../src/infrastructure/config/environment-config.js';
import { createDatabaseClient } from '../src/infrastructure/database/client.js';
import { PrismaM1Repository } from '../src/modules/control-plane/infrastructure/prisma-m1.repository.js';
import { M1ControlPlaneService } from '../src/modules/control-plane/application/m1-control-plane.service.js';
import type { DatabaseService } from '../src/infrastructure/database/database.service.js';
import type { Principal } from '../src/modules/identity/domain/principal.js';

const runId = randomUUID();
const applicationName = `admission-lock-${runId.slice(0, 8)}`;
const baseConfig = loadConfig();
const config = {
  ...baseConfig,
  database: { ...baseConfig.database, applicationName },
};
const db = createDatabaseClient(config);
const control = new M1ControlPlaneService(
  new PrismaM1Repository(db as unknown as DatabaseService),
);
const blocker = new pg.Client({ connectionString: config.databaseUrl });
const observer = new pg.Client({ connectionString: config.databaseUrl });
const operator: Principal = {
  subject: 'admission-lock-operator',
  kind: 'operator',
  roles: ['platform-operator'],
  scopes: ['platform:manage'],
};

type Fixture = Awaited<ReturnType<typeof setupFixture>>;

before(async () => {
  await Promise.all([blocker.connect(), observer.connect()]);
});

after(async () => {
  await db.$disconnect();
  await Promise.allSettled([blocker.end(), observer.end()]);
});

async function setupFixture(options: { activePeer?: boolean } = {}) {
  const id = `admission-lock-${randomUUID()}`;
  const applicationId = `${id}-app`;
  const primaryConnectionId = `${id}-primary`;
  const peerConnectionId = `${id}-peer`;
  const quotaGroupRef = `${id}-quota`;
  const applicationAccountId = `${id}-application-budget`;
  const quotaAccountId = `${id}-quota-budget`;
  const profileRef = `${id}-profile`;
  const profileId = randomUUID();
  const bindingId = randomUUID();
  const gatewayMaxConcurrency = options.activePeer ? 1 : 100;

  await db.controlApplication.create({
    data: {
      id: applicationId,
      displayName: 'Admission lock protocol fixture',
      environment: 'local',
      keycloakClientId: `${id}-client`,
      gatewayMaxConcurrency: 100,
      gatewayRequestsPerMinute: 1000,
    },
  });
  for (const connectionId of [primaryConnectionId, peerConnectionId]) {
    await db.aiConnection.create({
      data: {
        id: connectionId,
        displayName: 'Admission lock protocol fixture',
        provider: 'fixture',
        authMode: 'API_KEY',
        environment: 'local',
        sharingMode: 'SHARED',
        quotaGroupRef,
        gatewayMaxConcurrency,
        gatewayRequestsPerMinute: 1000,
      },
    });
  }
  await db.credentialBinding.create({
    data: {
      id: bindingId,
      applicationId,
      connectionId: primaryConnectionId,
      profileRef: null,
    },
  });
  await db.budgetAccount.createMany({
    data: [
      {
        id: applicationAccountId,
        applicationId,
        quotaGroupRef: null,
        unit: 'fixture-units',
        period: 'test',
        limitUnits: 100n,
      },
      {
        id: quotaAccountId,
        applicationId: null,
        quotaGroupRef,
        unit: 'fixture-units',
        period: 'test',
        limitUnits: 100n,
      },
    ],
  });
  await db.profileRevision.create({
    data: {
      id: profileId,
      applicationId,
      profileRef,
      revision: 1,
      connectionId: primaryConnectionId,
      capability: 'chat',
      providerAdapter: 'fixture',
      model: 'fixture',
      holdUnits: 1n,
      accountIds: [applicationAccountId, quotaAccountId],
      digest: 'a'.repeat(64),
    },
  });
  await db.profileAlias.create({
    data: { applicationId, profileRef, revision: 1 },
  });

  if (options.activePeer) {
    const peerProfileId = randomUUID();
    await db.profileRevision.create({
      data: {
        id: peerProfileId,
        applicationId,
        profileRef: `${profileRef}-peer`,
        revision: 1,
        connectionId: peerConnectionId,
        capability: 'chat',
        providerAdapter: 'fixture',
        model: 'fixture',
        holdUnits: 0n,
        accountIds: [applicationAccountId, quotaAccountId],
        digest: 'b'.repeat(64),
      },
    });
    await db.execution.create({
      data: {
        id: randomUUID(),
        applicationId,
        idempotencyKey: `${id}-active-peer`,
        requestDigest: 'c'.repeat(64),
        profileRevisionId: peerProfileId,
        profileSnapshot: {},
      },
    });
  }

  const principal: Principal = {
    subject: applicationId,
    kind: 'application',
    applicationId,
    roles: ['runtime-application'],
    scopes: ['execution:submit'],
  };
  return {
    id,
    applicationId,
    primaryConnectionId,
    peerConnectionId,
    quotaGroupRef,
    applicationAccountId,
    quotaAccountId,
    profileRef,
    bindingId,
    principal,
  };
}

async function cleanupFixture(fixture: Fixture) {
  const executions = await db.execution.findMany({
    where: { applicationId: fixture.applicationId },
    select: { id: true },
  });
  const executionIds = executions.map(({ id }) => id);
  await db.outboxEvent.deleteMany({
    where: { applicationId: fixture.applicationId },
  });
  await db.reservation.deleteMany({
    where: { executionId: { in: executionIds } },
  });
  await db.attempt.deleteMany({
    where: { executionId: { in: executionIds } },
  });
  await db.execution.deleteMany({
    where: { applicationId: fixture.applicationId },
  });
  await db.auditEntry.deleteMany({
    where: { applicationId: fixture.applicationId },
  });
  await db.admissionRateWindow.deleteMany({
    where: {
      scopeKey: {
        in: [
          `application:${fixture.applicationId}`,
          `quota:${fixture.quotaGroupRef}`,
        ],
      },
    },
  });
  await db.profileAlias.deleteMany({
    where: { applicationId: fixture.applicationId },
  });
  await db.profileRevision.deleteMany({
    where: { applicationId: fixture.applicationId },
  });
  await db.budgetAccount.deleteMany({
    where: {
      id: { in: [fixture.applicationAccountId, fixture.quotaAccountId] },
    },
  });
  await db.credentialBinding.deleteMany({
    where: { applicationId: fixture.applicationId },
  });
  await db.aiConnection.deleteMany({
    where: {
      id: { in: [fixture.primaryConnectionId, fixture.peerConnectionId] },
    },
  });
  await db.controlApplication.delete({
    where: { id: fixture.applicationId },
  });
}

async function waitForLock(kind: 'advisory' | 'row', minimum: number) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const { rows } = await observer.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM pg_stat_activity
       WHERE application_name = $1 AND wait_event_type = 'Lock'
         AND CASE WHEN $2 = 'advisory'
           THEN wait_event = 'advisory'
           ELSE wait_event <> 'advisory'
         END`,
      [applicationName, kind],
    );
    if (Number(rows[0]?.count) >= minimum) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for ${minimum} ${kind} lock waiter(s).`);
}

function admission(fixture: Fixture, key: string) {
  return control.admit(
    fixture.principal,
    { profileRef: fixture.profileRef, inputDigest: 'd'.repeat(64) },
    key,
  );
}

test('profile alias changes and admission share an explicit row ordering point', async () => {
  const fixture = await setupFixture();
  let held = false;
  try {
    await blocker.query('BEGIN');
    held = true;
    await blocker.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [`quota:${fixture.quotaGroupRef}`],
    );
    const admitted = admission(fixture, `${fixture.id}-alias-first`);
    await waitForLock('advisory', 1);
    const disabled = control.manage(operator, {
      kind: 'alias',
      id: fixture.profileRef,
      applicationId: fixture.applicationId,
      expectedRevision: 1,
      revision: 1,
      enabled: false,
    });
    await waitForLock('row', 1);
    await blocker.query('COMMIT');
    held = false;
    await admitted;
    await disabled;
    await assert.rejects(
      admission(fixture, `${fixture.id}-after-alias-disable`),
      { code: 'NOT_FOUND' },
    );
  } finally {
    if (held) {
      await blocker.query('ROLLBACK');
    }
    await cleanupFixture(fixture);
  }
});

test('budget limit management queues behind admission and revalidates exposure', async () => {
  const fixture = await setupFixture();
  let held = false;
  try {
    await blocker.query('BEGIN');
    held = true;
    await blocker.query(
      'SELECT id FROM control.budget_accounts WHERE id = $1 FOR UPDATE',
      [fixture.applicationAccountId],
    );
    const admitted = admission(fixture, `${fixture.id}-budget-first`);
    await waitForLock('row', 1);
    const lowered = control.manage(operator, {
      kind: 'budget',
      id: fixture.applicationAccountId,
      expectedRevision: 1,
      applicationId: fixture.applicationId,
      quotaGroupRef: null,
      unit: 'fixture-units',
      period: 'test',
      limitUnits: '0',
    });
    await waitForLock('row', 2);
    await blocker.query('COMMIT');
    held = false;
    await admitted;
    await assert.rejects(lowered, { code: 'INVALID_REQUEST' });
    const account = await db.budgetAccount.findUniqueOrThrow({
      where: { id: fixture.applicationAccountId },
    });
    assert.equal(account.limitUnits, 100n);
    assert.equal(account.heldUnits, 1n);
  } finally {
    if (held) {
      await blocker.query('ROLLBACK');
    }
    await cleanupFixture(fixture);
  }
});

test('shared quota-group reconfiguration is ordered before admission capacity', async () => {
  const fixture = await setupFixture({ activePeer: true });
  const quotaBlocker = new pg.Client({ connectionString: config.databaseUrl });
  let held = false;
  let quotaHeld = false;
  try {
    await quotaBlocker.connect();
    await blocker.query('BEGIN');
    held = true;
    await blocker.query(
      'SELECT id FROM control.applications WHERE id = $1 FOR UPDATE',
      [fixture.applicationId],
    );
    await quotaBlocker.query('BEGIN');
    quotaHeld = true;
    await quotaBlocker.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [`quota:${fixture.quotaGroupRef}`],
    );
    const reconfigured = control.manage(operator, {
      kind: 'connection',
      id: fixture.peerConnectionId,
      expectedRevision: 1,
      displayName: 'Admission lock protocol fixture',
      environment: 'local',
      provider: 'fixture',
      authMode: 'API_KEY',
      sharingMode: 'DEDICATED',
      quotaGroupRef: null,
      gatewayMaxConcurrency: 1,
      gatewayRequestsPerMinute: 1000,
      status: 'ENABLED',
    });
    await waitForLock('advisory', 1);
    const admitted = admission(fixture, `${fixture.id}-move-first`);
    await waitForLock('row', 1);
    // Keep admission behind the app row until the logical management command
    // commits. Releasing both blockers together allows a Serializable retry
    // to release the quota lock and give admission a valid earlier turn.
    await quotaBlocker.query('COMMIT');
    quotaHeld = false;
    await reconfigured;
    await blocker.query('COMMIT');
    held = false;
    await admitted;
    const peer = await db.aiConnection.findUniqueOrThrow({
      where: { id: fixture.peerConnectionId },
    });
    assert.equal(peer.sharingMode, 'DEDICATED');
    assert.equal(peer.quotaGroupRef, null);
  } finally {
    if (quotaHeld) {
      await quotaBlocker.query('ROLLBACK');
    }
    if (held) {
      await blocker.query('ROLLBACK');
    }
    await quotaBlocker.end();
    await cleanupFixture(fixture);
  }
});
