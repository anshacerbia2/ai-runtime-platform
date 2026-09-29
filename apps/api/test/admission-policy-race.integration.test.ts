import { randomUUID } from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { loadConfig } from '../src/infrastructure/config/environment-config.js';
import { createDatabaseClient } from '../src/infrastructure/database/client.js';
import { PrismaM1Repository } from '../src/modules/control-plane/infrastructure/prisma-m1.repository.js';
import { M1ControlPlaneService } from '../src/modules/control-plane/application/m1-control-plane.service.js';
import type { DatabaseService } from '../src/infrastructure/database/database.service.js';
import type { Principal } from '../src/modules/identity/domain/principal.js';

const suffix = randomUUID();
const prefix = `admission-race-${suffix}`;
const applicationId = `${prefix}-app`;
const connectionId = `${prefix}-connection`;
const accountId = `${prefix}-budget`;
const bindingId = randomUUID();
const profileRef = `${prefix}-profile`;
const applicationName = `admission-race-${suffix.slice(0, 8)}`;
const baseConfig = loadConfig();
const config = {
  ...baseConfig,
  database: { ...baseConfig.database, applicationName },
};
const db = createDatabaseClient(config);
const repository = new PrismaM1Repository(db as unknown as DatabaseService);
const control = new M1ControlPlaneService(repository);
const blocker = new pg.Client({ connectionString: config.databaseUrl });
const observer = new pg.Client({ connectionString: config.databaseUrl });

const application: Principal = {
  subject: applicationId,
  kind: 'application',
  applicationId,
  roles: ['runtime-application'],
  scopes: ['execution:submit'],
};
const operator: Principal = {
  subject: 'race-test-operator',
  kind: 'operator',
  roles: ['platform-operator'],
  scopes: ['platform:manage'],
};

async function setup() {
  await db.controlApplication.create({
    data: {
      id: applicationId,
      displayName: 'Admission race fixture',
      environment: 'local',
      keycloakClientId: `${prefix}-client`,
    },
  });
  await db.aiConnection.create({
    data: {
      id: connectionId,
      displayName: 'Admission race fixture',
      provider: 'fixture',
      authMode: 'API_KEY',
      environment: 'local',
      sharingMode: 'DEDICATED',
      quotaGroupRef: null,
    },
  });
  await db.credentialBinding.create({
    data: {
      id: bindingId,
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
      unit: 'fixture-units',
      period: 'test',
      limitUnits: 100n,
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
}

async function cleanup() {
  const executions = await db.execution.findMany({
    where: { applicationId },
    select: { id: true },
  });
  const ids = executions.map((item) => item.id);
  await db.outboxEvent.deleteMany({ where: { applicationId } });
  await db.reservation.deleteMany({ where: { executionId: { in: ids } } });
  await db.attempt.deleteMany({ where: { executionId: { in: ids } } });
  await db.execution.deleteMany({ where: { applicationId } });
  await db.auditEntry.deleteMany({ where: { applicationId } });
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

async function waitForAdvisoryWait() {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const { rows } = await observer.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM pg_stat_activity
       WHERE application_name = $1 AND wait_event_type = 'Lock'
         AND wait_event = 'advisory'`,
      [applicationName],
    );
    if (Number(rows[0]?.count) > 0) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('Admission never reached the route advisory lock.');
}

async function waitForPolicyRowWait() {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const { rows } = await observer.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM pg_stat_activity
       WHERE application_name = $1 AND wait_event_type = 'Lock'
         AND wait_event <> 'advisory'`,
      [applicationName],
    );
    if (Number(rows[0]?.count) > 0) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('Policy transaction never waited on its row lock.');
}

const applicationCommand = (
  expectedRevision: number,
  status: 'ENABLED' | 'DISABLED',
) => ({
  kind: 'application' as const,
  id: applicationId,
  expectedRevision,
  displayName: 'Admission race fixture',
  environment: 'local',
  keycloakClientId: `${prefix}-client`,
  gatewayMaxConcurrency: 100,
  gatewayRequestsPerMinute: 600,
  status,
});

const connectionCommand = (
  expectedRevision: number,
  status: 'ENABLED' | 'DISABLED',
) => ({
  kind: 'connection' as const,
  id: connectionId,
  expectedRevision,
  displayName: 'Admission race fixture',
  environment: 'local',
  provider: 'fixture',
  authMode: 'API_KEY' as const,
  sharingMode: 'DEDICATED' as const,
  quotaGroupRef: null,
  gatewayMaxConcurrency: 100,
  gatewayRequestsPerMinute: 600,
  status,
});

const bindingCommand = (
  expectedRevision: number,
  status: 'ENABLED' | 'DISABLED',
) => ({
  kind: 'binding' as const,
  id: bindingId,
  expectedRevision,
  applicationId,
  connectionId,
  profileRef: null,
  status,
});

test('admission and application, connection, binding revocation have a database-enforced ordering point', async () => {
  let held = false;
  let admitted: Promise<{ value?: unknown; error?: unknown }> | null = null;
  let disabling: Promise<{ value?: unknown; error?: unknown }> | null = null;
  let secondAdmission: Promise<{ value?: unknown; error?: unknown }> | null =
    null;
  try {
    await Promise.all([blocker.connect(), observer.connect()]);
    await setup();
    await blocker.query('BEGIN');
    held = true;
    await blocker.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [`connection:${connectionId}`],
    );
    admitted = control
      .admit(
        application,
        { profileRef, inputDigest: 'b'.repeat(64) },
        `race-${suffix}`,
      )
      .then(
        (value) => ({ value }),
        (error: unknown) => ({ error }),
      );
    await waitForAdvisoryWait();
    disabling = control
      .manage(operator, applicationCommand(1, 'DISABLED'))
      .then(
        (value) => ({ value }),
        (error: unknown) => ({ error }),
      );
    await waitForPolicyRowWait();
    await blocker.query('COMMIT');
    held = false;
    const outcome = await admitted;
    const disabled = await disabling;
    assert.ok(disabled.value, JSON.stringify(disabled));
    assert.ok(outcome.value, JSON.stringify(outcome));
    let acceptedCount = 1;
    await assert.rejects(
      control.admit(
        application,
        { profileRef, inputDigest: 'c'.repeat(64) },
        `after-disable-${suffix}`,
      ),
      { code: 'POLICY_DENIED' },
    );

    await control.manage(operator, applicationCommand(2, 'ENABLED'));
    await blocker.query('BEGIN');
    held = true;
    await blocker.query(
      `UPDATE control.applications SET status = 'DISABLED', revision = revision + 1
       WHERE id = $1`,
      [applicationId],
    );
    secondAdmission = control
      .admit(
        application,
        { profileRef, inputDigest: 'd'.repeat(64) },
        `disable-first-${suffix}`,
      )
      .then(
        (value) => ({ value }),
        (error: unknown) => ({ error }),
      );
    await waitForPolicyRowWait();
    await blocker.query('COMMIT');
    held = false;
    const denied = await secondAdmission;
    assert.equal(
      (denied.error as { code?: string })?.code,
      'POLICY_DENIED',
      JSON.stringify(denied),
    );
    assert.equal(
      await db.execution.count({ where: { applicationId } }),
      acceptedCount,
    );

    await control.manage(operator, applicationCommand(4, 'ENABLED'));
    const revocations = [
      {
        name: 'connection',
        disable: connectionCommand(1, 'DISABLED'),
        reenable: connectionCommand(2, 'ENABLED'),
      },
      {
        name: 'binding',
        disable: bindingCommand(1, 'DISABLED'),
        reenable: bindingCommand(2, 'ENABLED'),
      },
    ];
    for (const revocation of revocations) {
      await blocker.query('BEGIN');
      held = true;
      await blocker.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [`connection:${connectionId}`],
      );
      admitted = control
        .admit(
          application,
          { profileRef, inputDigest: 'e'.repeat(64) },
          `${revocation.name}-first-${suffix}`,
        )
        .then(
          (value) => ({ value }),
          (error: unknown) => ({ error }),
        );
      await waitForAdvisoryWait();
      disabling = control.manage(operator, revocation.disable).then(
        (value) => ({ value }),
        (error: unknown) => ({ error }),
      );
      await waitForPolicyRowWait();
      await blocker.query('COMMIT');
      held = false;
      const accepted = await admitted;
      const disabledPolicy = await disabling;
      assert.ok(disabledPolicy.value, JSON.stringify(disabledPolicy));
      assert.ok(accepted.value, JSON.stringify(accepted));
      acceptedCount++;
      await assert.rejects(
        control.admit(
          application,
          { profileRef, inputDigest: 'f'.repeat(64) },
          `${revocation.name}-after-${suffix}`,
        ),
        { code: 'POLICY_DENIED' },
      );
      await control.manage(operator, revocation.reenable);
    }
    for (const kind of ['connection', 'binding'] as const) {
      await blocker.query('BEGIN');
      held = true;
      if (kind === 'connection') {
        await blocker.query(
          `UPDATE control.ai_connections SET status = 'DISABLED', revision = revision + 1
           WHERE id = $1`,
          [connectionId],
        );
      } else {
        await blocker.query(
          `UPDATE control.credential_bindings SET status = 'DISABLED', revision = revision + 1
           WHERE id = $1`,
          [bindingId],
        );
      }
      admitted = control
        .admit(
          application,
          { profileRef, inputDigest: 'g'.repeat(64) },
          `${kind}-disable-first-${suffix}`,
        )
        .then(
          (value) => ({ value }),
          (error: unknown) => ({ error }),
        );
      await waitForPolicyRowWait();
      await blocker.query('COMMIT');
      held = false;
      const deniedPolicy = await admitted;
      assert.equal(
        (deniedPolicy.error as { code?: string })?.code,
        'POLICY_DENIED',
        JSON.stringify(deniedPolicy),
      );
      if (kind === 'connection') {
        await db.aiConnection.update({
          where: { id: connectionId },
          data: { status: 'ENABLED' },
        });
      } else {
        await db.credentialBinding.update({
          where: { id: bindingId },
          data: { status: 'ENABLED' },
        });
      }
    }
    assert.equal(
      await db.execution.count({ where: { applicationId } }),
      acceptedCount,
    );
  } finally {
    if (held) {
      await blocker.query('ROLLBACK');
    }
    await admitted;
    await disabling;
    await secondAdmission;
    await cleanup();
    await db.$disconnect();
    await Promise.allSettled([blocker.end(), observer.end()]);
  }
});
