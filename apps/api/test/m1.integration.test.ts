import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { InjectOptions } from 'fastify';
import { createApplication } from '../dist/bootstrap.js';
import { loadConfig } from '../src/infrastructure/config/environment-config.js';
import { createDatabaseClient } from '../src/infrastructure/database/client.js';
import { seedDatabase } from '../src/infrastructure/database/seed.js';

const prefix = `m1test-${randomUUID()}`;
const config = {
  ...loadConfig(),
  localOperatorToken: randomUUID(),
  localRunnerToken: randomUUID(),
  applications: [
    { id: `${prefix}-a`, name: 'M1 test A', token: randomUUID() },
    { id: `${prefix}-b`, name: 'M1 test B', token: randomUUID() },
  ],
};
const db = createDatabaseClient(config);
let app: Awaited<ReturnType<typeof createApplication>>;
const a = config.applications[0]!;
const b = config.applications[1]!;
const op = config.localOperatorToken;
const scope = { applicationId: { in: [a.id, b.id] } };
function request(
  method: InjectOptions['method'],
  url: string,
  token: string,
  payload?: InjectOptions['payload'],
  key?: string,
) {
  return app.inject({
    method,
    url: `/api/m1/${url}`,
    headers: {
      host: `${config.apiHost}:${config.apiPort}`,
      authorization: `Bearer ${token}`,
      ...(key ? { 'idempotency-key': key } : {}),
    },
    payload,
  });
}
async function manage(command: object, code = 200) {
  const result = await request('PUT', 'control-plane', op, command);
  assert.equal(result.statusCode, code, result.body);
  return result.json();
}
async function fixture(
  name: string,
  limit = '100',
  hold = '1',
  shared = false,
) {
  const id = `${prefix}-${name}`;
  const connectionId = `${id}-connection`;
  await manage({
    kind: 'connection',
    id: connectionId,
    expectedRevision: 0,
    displayName: name,
    environment: 'local',
    provider: 'fixture',
    authMode: 'API_KEY',
    sharingMode: shared ? 'SHARED' : 'DEDICATED',
    quotaGroupRef: shared ? id : null,
    status: 'ENABLED',
  });
  await manage({
    kind: 'binding',
    id: randomUUID(),
    expectedRevision: 0,
    applicationId: a.id,
    connectionId,
    profileRef: null,
    status: 'ENABLED',
  });
  const accountId = `${id}-account`;
  await manage({
    kind: 'budget',
    id: accountId,
    expectedRevision: 0,
    applicationId: a.id,
    quotaGroupRef: null,
    unit: 'fixture-units',
    period: 'test',
    limitUnits: limit,
  });
  const accountIds = [accountId];
  if (shared) {
    accountIds.push(`${id}-quota`);
    await manage({
      kind: 'budget',
      id: accountIds[1],
      expectedRevision: 0,
      applicationId: null,
      quotaGroupRef: id,
      unit: 'fixture-units',
      period: 'test',
      limitUnits: limit,
    });
  }
  const profile = {
    kind: 'profile',
    id,
    expectedRevision: 0,
    applicationId: a.id,
    connectionId,
    capability: 'chat',
    holdUnits: hold,
    accountIds,
    enabled: true,
  };
  await manage(profile);
  const body = { profileRef: id, inputDigest: 'a'.repeat(64) };
  return {
    id,
    connectionId,
    accountId,
    accountIds,
    profile,
    body,
    admit: (key = randomUUID(), token = a.token) =>
      request('POST', 'admissions', token, body, key),
  };
}
async function read(id: string) {
  const response = await request('GET', `executions/${id}`, a.token);
  assert.equal(response.statusCode, 200, response.body);
  return response.json();
}
async function evidence(id: string, overrides: object = {}) {
  const execution = await read(id);
  return {
    executionId: id,
    attemptId: execution.attempts[0].id,
    sourceEventId: 'provider-summary',
    sourceRevision: 1,
    coverage: ['invocation-1'],
    cumulativeUnits: '2',
    completeness: 'partial',
    costBasis: 'provider_reported',
    reason: 'Local verified fixture',
    ...overrides,
  };
}
async function injectFailure(
  table: 'outbox_events' | 'ledger_entries',
  work: () => Promise<void>,
) {
  const name = `m1_fault_${randomUUID().replaceAll('-', '')}`;
  const condition =
    table === 'outbox_events'
      ? `NEW.application_id = '${a.id}'`
      : `EXISTS (SELECT 1 FROM control.executions WHERE id = NEW.execution_id AND application_id = '${a.id}')`;
  // Identifiers and predicate values come only from UUID-generated test fixtures.
  await db.$executeRawUnsafe(
    `CREATE FUNCTION control.${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF ${condition} THEN RAISE EXCEPTION 'M1 scoped fault injection'; END IF; RETURN NEW; END $$`,
  );
  await db.$executeRawUnsafe(
    `CREATE TRIGGER ${name} AFTER INSERT ON control.${table} FOR EACH ROW EXECUTE FUNCTION control.${name}()`,
  );
  try {
    await work();
  } finally {
    await db.$executeRawUnsafe(`DROP TRIGGER ${name} ON control.${table}`);
    await db.$executeRawUnsafe(`DROP FUNCTION control.${name}()`);
  }
}

before(async () => {
  await seedDatabase(db, config);
  app = await createApplication(config);
});
after(async () => {
  await app?.close();
  // Delete only fixtures created by this test run, preserving pre-existing data.
  const ids = (
    await db.execution.findMany({ where: scope, select: { id: true } })
  ).map((item) => item.id);
  const events = (
    await db.outboxEvent.findMany({ where: scope, select: { id: true } })
  ).map((item) => item.id);
  await db.inboxReceipt.deleteMany({ where: { eventId: { in: events } } });
  await db.outboxEvent.deleteMany({ where: scope });
  await db.ledgerEntry.deleteMany({ where: { executionId: { in: ids } } });
  await db.usageObservation.deleteMany({ where: { executionId: { in: ids } } });
  await db.artifactMetadata.deleteMany({ where: { executionId: { in: ids } } });
  await db.reservation.deleteMany({ where: { executionId: { in: ids } } });
  await db.attempt.deleteMany({ where: { executionId: { in: ids } } });
  await db.execution.deleteMany({ where: scope });
  await db.profileAlias.deleteMany({ where: scope });
  await db.profileRevision.deleteMany({ where: scope });
  await db.budgetProjection.deleteMany({
    where: { accountId: { startsWith: prefix } },
  });
  await db.budgetAccount.deleteMany({ where: { id: { startsWith: prefix } } });
  await db.credentialBinding.deleteMany({ where: scope });
  await db.credentialInstance.deleteMany({
    where: { id: { startsWith: prefix } },
  });
  await db.runnerNode.deleteMany({ where: { id: { startsWith: prefix } } });
  await db.runnerPool.deleteMany({ where: { id: { startsWith: prefix } } });
  await db.aiConnection.deleteMany({ where: { id: { startsWith: prefix } } });
  await db.auditEntry.deleteMany({
    where: { OR: [scope, { resourceId: { startsWith: prefix } }] },
  });
  await db.controlApplication.deleteMany({
    where: { id: { in: [a.id, b.id] } },
  });
  await db.profile.deleteMany({ where: scope });
  await db.application.deleteMany({ where: { id: { in: [a.id, b.id] } } });
  await db.$disconnect();
});

test('G01/G26 operator-only mutations; application scope protects admission, execution, artifacts, usage and audit', async () => {
  const f = await fixture('scope');
  assert.equal(
    (await request('PUT', 'control-plane', a.token, f.profile)).statusCode,
    403,
  );
  assert.equal(
    (await request('POST', 'admissions', op, f.body, randomUUID())).statusCode,
    403,
  );
  assert.equal((await f.admit(randomUUID(), b.token)).statusCode, 404);
  assert.equal(
    (
      await request(
        'POST',
        'admissions',
        a.token,
        { ...f.body, applicationId: b.id },
        randomUUID(),
      )
    ).statusCode,
    400,
  );
  const accepted = await f.admit();
  assert.equal(accepted.statusCode, 201, accepted.body);
  const id = accepted.json().execution.id;
  assert.equal(
    (await request('GET', `executions/${id}`, b.token)).statusCode,
    404,
  );
  assert.equal(
    (await request('POST', `executions/${id}/cancel`, b.token, {})).statusCode,
    404,
  );
  const artifact = {
    id: randomUUID(),
    executionId: id,
    name: 'result.json',
    digest: 'b'.repeat(64),
    sizeBytes: '12',
    mediaType: 'application/json',
  };
  assert.equal(
    (await request('POST', 'artifacts', b.token, artifact)).statusCode,
    404,
  );
  assert.equal(
    (await request('POST', 'artifacts', a.token, artifact)).statusCode,
    201,
  );
  assert.equal(
    (await request('POST', 'artifacts', a.token, artifact)).json().replayed,
    true,
  );
  assert.equal(
    (await request('POST', 'usage', a.token, await evidence(id))).statusCode,
    403,
  );
  assert.equal((await request('GET', 'audit', a.token)).statusCode, 403);
  assert.equal((await request('GET', 'outbox', a.token)).statusCode, 403);
  const snapshot = (await request('GET', 'control-plane', b.token)).json();
  assert.equal(snapshot.application.id, b.id);
  assert.equal(
    snapshot.executions.some((item: { id: string }) => item.id === id),
    false,
  );
  assert.equal(
    (await request('GET', 'executions/not-a-uuid', a.token)).statusCode,
    400,
  );
});

test('G02/G09 concurrent idempotency, immutable profile snapshot, alias rollback, restart replay and cancel intent', async () => {
  const f = await fixture('replay', '100', '2');
  const key = randomUUID();
  const results = await Promise.all(
    Array.from({ length: 16 }, () => f.admit(key)),
  );
  assert.equal(results.filter((r) => r.statusCode === 201).length, 1);
  assert.equal(
    results.filter((r) => r.statusCode === 200).length,
    15,
    results.map((r) => r.body).join('\n'),
  );
  const id = results[0]!.json().execution.id;
  assert.equal(new Set(results.map((r) => r.json().execution.id)).size, 1);
  assert.equal(
    (await db.budgetAccount.findUniqueOrThrow({ where: { id: f.accountId } }))
      .heldUnits,
    2n,
  );
  assert.equal(await db.attempt.count({ where: { executionId: id } }), 1);
  assert.equal(
    await db.outboxEvent.count({
      where: { topic: 'execution.admitted', aggregateId: id },
    }),
    1,
  );
  assert.equal(
    (
      await request(
        'POST',
        'admissions',
        a.token,
        { ...f.body, inputDigest: 'b'.repeat(64) },
        key,
      )
    ).statusCode,
    409,
  );
  await manage({ ...f.profile, expectedRevision: 1, holdUnits: '3' });
  assert.equal((await f.admit(key)).json().execution.profileRevision, 1);
  await manage({
    kind: 'alias',
    id: f.id,
    applicationId: a.id,
    expectedRevision: 2,
    revision: 1,
    enabled: true,
  });
  assert.equal(
    (await manage({ ...f.profile, expectedRevision: 3, holdUnits: '4' }))
      .revision,
    3,
  );
  const revision = await db.profileRevision.findFirstOrThrow({
    where: { applicationId: a.id, profileRef: f.id, revision: 1 },
  });
  await assert.rejects(
    db.profileRevision.update({
      where: { id: revision.id },
      data: { holdUnits: 99n },
    }),
  );
  await app.close();
  app = await createApplication(config);
  assert.equal((await f.admit(key)).json().execution.id, id);
  const cancels = await Promise.all(
    Array.from({ length: 12 }, () =>
      request('POST', `executions/${id}/cancel`, a.token, { reason: 'test' }),
    ),
  );
  assert.ok(
    cancels.every((r) => r.statusCode === 201),
    cancels.map((r) => r.body).join('\n'),
  );
  assert.equal(
    await db.outboxEvent.count({
      where: { topic: 'execution.cancel-requested', aggregateId: id },
    }),
    1,
  );
  const view = await read(id);
  assert.equal(view.status, 'ACCEPTED');
  assert.equal(view.attempts[0].status, 'PREPARED');
  assert.equal(
    view.accounting.reservations[0].heldUnits,
    '2',
    'Cancel intent is not evidence of zero cost',
  );
});

test('G07 fifty concurrent admissions reserve exactly three units with no rejected mutation', async () => {
  const f = await fixture('race', '3');
  const responses = await Promise.all(
    Array.from({ length: 50 }, () => f.admit()),
  );
  assert.equal(responses.filter((r) => r.statusCode === 201).length, 3);
  assert.equal(
    responses.filter((r) => r.statusCode === 429).length,
    47,
    responses.map((r) => r.body).join('\n'),
  );
  const account = await db.budgetAccount.findUniqueOrThrow({
    where: { id: f.accountId },
  });
  assert.equal(account.heldUnits, 3n);
  assert.equal(account.postedUnits, 0n);
  assert.equal(
    await db.reservation.count({ where: { accountId: f.accountId } }),
    3,
  );
});

test('G08/G09 injected transaction failures leave no orphan hold, observation, charge or outbox', async () => {
  const f = await fixture('rollback', '10', '5');
  const key = randomUUID();
  await injectFailure('outbox_events', async () => {
    assert.equal((await f.admit(key)).statusCode, 503);
    assert.equal(
      await db.execution.count({
        where: { applicationId: a.id, idempotencyKey: key },
      }),
      0,
    );
    assert.equal(
      (await db.budgetAccount.findUniqueOrThrow({ where: { id: f.accountId } }))
        .heldUnits,
      0n,
    );
  });
  const id = (await f.admit(key)).json().execution.id;
  const command = await evidence(id, { completeness: 'complete' });
  await injectFailure('ledger_entries', async () => {
    assert.equal((await request('POST', 'usage', op, command)).statusCode, 503);
    assert.equal(
      await db.usageObservation.count({ where: { executionId: id } }),
      0,
    );
    const account = await db.budgetAccount.findUniqueOrThrow({
      where: { id: f.accountId },
    });
    assert.equal(account.heldUnits, 5n);
    assert.equal(account.postedUnits, 0n);
  });
  assert.equal((await request('POST', 'usage', op, command)).statusCode, 201);
  await app.close();
  app = await createApplication(config);
  assert.equal(
    (await request('POST', 'usage', op, command)).json().replayed,
    true,
  );
  assert.equal(await db.ledgerEntry.count({ where: { executionId: id } }), 1);
});

test('G08/G15 unknown remains null, cumulative charges and corrections post once, overlap denied, overage recorded', async () => {
  const f = await fixture('usage', '100', '10');
  const id = (await f.admit()).json().execution.id;
  const unknown = await evidence(id, {
    cumulativeUnits: null,
    completeness: 'unknown',
    costBasis: 'unknown',
  });
  for (let i = 0; i < 2; i++) {
    const r = await request('POST', 'usage', op, unknown);
    assert.equal(r.statusCode, 201, r.body);
    assert.equal(r.json().postedDelta, null);
  }
  assert.equal((await read(id)).observations[0].cumulativeUnits, null);
  assert.equal(await db.ledgerEntry.count({ where: { executionId: id } }), 0);
  const partial = await evidence(id, {
    sourceRevision: 2,
    cumulativeUnits: '4',
  });
  const results = await Promise.all(
    Array.from({ length: 12 }, () => request('POST', 'usage', op, partial)),
  );
  assert.ok(
    results.every((r) => r.statusCode === 201),
    results.map((r) => r.body).join('\n'),
  );
  assert.equal(results.filter((r) => !r.json().replayed).length, 1);
  assert.equal((await read(id)).accounting.reservations[0].heldUnits, '6');
  assert.equal(
    (await request('POST', 'usage', op, { ...partial, cumulativeUnits: '5' }))
      .statusCode,
    409,
  );
  assert.equal(
    (
      await request('POST', 'usage', op, {
        ...partial,
        sourceEventId: 'parent-summary',
      })
    ).statusCode,
    409,
  );
  assert.equal(
    (
      await request('POST', 'usage', op, { ...unknown, sourceRevision: 3 })
    ).json().postedDelta,
    null,
  );
  const final = await evidence(id, {
    sourceRevision: 4,
    cumulativeUnits: '7',
    completeness: 'complete',
  });
  assert.equal(
    (await request('POST', 'usage', op, final)).json().postedDelta,
    '3',
  );
  assert.equal(
    (
      await request('POST', 'usage', op, {
        ...final,
        sourceRevision: 5,
        cumulativeUnits: '6',
        reason: 'Price correction',
      })
    ).json().postedDelta,
    '-1',
  );
  const overage = await request('POST', 'usage', op, {
    ...final,
    sourceRevision: 6,
    cumulativeUnits: '110',
  });
  assert.equal(overage.statusCode, 201, overage.body);
  const view = await read(id);
  assert.equal(view.accounting.reservations[0].heldUnits, '0');
  assert.equal(view.accounting.reservations[0].state, 'OVERAGE_SETTLED');
  assert.equal(
    view.status,
    'ACCEPTED',
    'Accounting does not fabricate a runtime result',
  );
  assert.equal((await f.admit()).statusCode, 429);
  const entries = await db.ledgerEntry.findMany({ where: { executionId: id } });
  assert.equal(
    entries.reduce((sum, entry) => sum + entry.deltaUnits, 0n),
    110n,
  );
  assert.equal(
    entries.filter((entry) => entry.previousEntryId !== null).length,
    3,
  );
  const events = await db.outboxEvent.findMany({
    where: { aggregateId: f.accountId, topic: 'budget.updated' },
    orderBy: { revision: 'desc' },
  });
  const latest = events[0]!;
  const deliveries = await Promise.all(
    Array.from({ length: 10 }, () =>
      request('POST', `inbox/budget-projection/${latest.id}`, op),
    ),
  );
  assert.equal(
    deliveries.filter((r) => r.statusCode === 201 && !r.json().replayed).length,
    1,
  );
  for (const event of events.slice(1)) {
    assert.equal(
      (await request('POST', `inbox/budget-projection/${event.id}`, op))
        .statusCode,
      201,
    );
  }
  const projection = await db.budgetProjection.findUniqueOrThrow({
    where: { accountId: f.accountId },
  });
  assert.equal(projection.revision, latest.revision);
  assert.deepEqual(projection.snapshot, latest.payload);
});

test('G28 shared quota and application accounts lock together; dedicated sharing and budget scope bypass denied', async () => {
  const f = await fixture('shared', '3', '1', true);
  await manage({
    kind: 'binding',
    id: randomUUID(),
    expectedRevision: 0,
    applicationId: b.id,
    connectionId: f.connectionId,
    profileRef: null,
    status: 'ENABLED',
  });
  const bAccount = `${f.id}-b-account`;
  await manage({
    kind: 'budget',
    id: bAccount,
    expectedRevision: 0,
    applicationId: b.id,
    quotaGroupRef: null,
    unit: 'fixture-units',
    period: 'test',
    limitUnits: '3',
  });
  await manage({
    ...f.profile,
    applicationId: b.id,
    accountIds: [f.accountIds[1], bAccount],
  });
  await manage(
    {
      kind: 'connection',
      id: f.connectionId,
      expectedRevision: 1,
      displayName: 'shared',
      environment: 'local',
      provider: 'fixture',
      authMode: 'API_KEY',
      sharingMode: 'DEDICATED',
      quotaGroupRef: null,
      status: 'ENABLED',
    },
    409,
  );
  const responses = await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      f.admit(randomUUID(), i % 2 ? a.token : b.token),
    ),
  );
  assert.equal(responses.filter((r) => r.statusCode === 201).length, 3);
  assert.equal(responses.filter((r) => r.statusCode === 429).length, 17);
  assert.equal(
    (
      await db.budgetAccount.findUniqueOrThrow({
        where: { id: f.accountIds[1] },
      })
    ).heldUnits,
    3n,
  );
  const dedicated = await fixture('dedicated');
  await manage(
    {
      kind: 'binding',
      id: randomUUID(),
      expectedRevision: 0,
      applicationId: b.id,
      connectionId: dedicated.connectionId,
      profileRef: null,
      status: 'ENABLED',
    },
    403,
  );
  await manage(
    { ...f.profile, id: `${f.id}-invalid`, accountIds: [bAccount] },
    403,
  );
});

test('G27 credential metadata is allow-listed, mutation audit and CAS are atomic, DB constraints reject invalid links', async () => {
  const f = await fixture('credentials');
  const credential = {
    kind: 'credential',
    id: `${prefix}-credential`,
    expectedRevision: 0,
    connectionId: f.connectionId,
    residency: 'CENTRAL',
    runnerRef: null,
    status: 'ENABLED',
  };
  await manage(credential);
  const secret = `vault://private/${randomUUID()}`;
  await db.credentialInstance.update({
    where: { id: credential.id },
    data: { secretRef: secret },
  });
  const responses = await Promise.all(
    Array.from({ length: 8 }, () =>
      request('PUT', 'control-plane', op, {
        ...credential,
        expectedRevision: 1,
        status: 'DISABLED',
      }),
    ),
  );
  assert.equal(responses.filter((r) => r.statusCode === 200).length, 1);
  assert.equal(responses.filter((r) => r.statusCode === 409).length, 7);
  for (const result of [
    ...responses,
    await request('GET', 'control-plane', op),
    await request('GET', 'audit', op),
  ]) {
    assert.equal(result.body.includes(secret), false);
    assert.equal(/secretRef|secret_ref/.test(result.body), false);
  }
  await manage({ ...credential, expectedRevision: 2, secretRef: secret }, 400);
  assert.equal(
    await db.auditEntry.count({ where: { resourceId: credential.id } }),
    2,
  );
  const one = (await f.admit()).json().execution.id;
  const two = (await f.admit()).json().execution.id;
  const wrongAttempt = (await read(two)).attempts[0].id;
  assert.equal(
    (
      await request(
        'POST',
        'usage',
        op,
        await evidence(one, { attemptId: wrongAttempt }),
      )
    ).statusCode,
    404,
  );
  await assert.rejects(
    db.usageObservation.create({
      data: {
        id: randomUUID(),
        executionId: one,
        attemptId: wrongAttempt,
        sourceEventId: 'forged',
        sourceRevision: 1,
        digest: 'a'.repeat(64),
        coverage: ['x'],
        cumulativeUnits: null,
        completeness: 'unknown',
        costBasis: 'unknown',
        verification: 'PENDING',
        reason: 'test',
      },
    }),
  );
  await assert.rejects(
    db.budgetAccount.update({
      where: { id: f.accountId },
      data: { heldUnits: -1n },
    }),
  );
});

test('G29 runner registration identity, pool version, duplicate registration and lifecycle foundations', async () => {
  const poolId = `${prefix}-pool`;
  await manage({
    kind: 'pool',
    id: poolId,
    expectedRevision: 0,
    environment: 'local',
    region: 'test',
    minimumVersion: '1.2.0',
    status: 'ENABLED',
  });
  const runner = {
    id: `${prefix}-node`,
    poolId,
    version: '1.2.1',
    capabilities: ['chat'],
    connectionIds: [],
    capacity: 2,
  };
  assert.equal(
    (await request('POST', 'runners/register', a.token, runner)).statusCode,
    403,
  );
  assert.equal(
    (
      await request('POST', 'runners/register', config.localRunnerToken, {
        ...runner,
        version: '1.1.9',
      })
    ).statusCode,
    403,
  );
  const registrations = await Promise.all(
    Array.from({ length: 6 }, () =>
      request('POST', 'runners/register', config.localRunnerToken, runner),
    ),
  );
  assert.ok(
    registrations.every((r) => r.statusCode === 201),
    registrations.map((r) => r.body).join('\n'),
  );
  assert.equal(await db.runnerNode.count({ where: { id: runner.id } }), 1);
  const node = await db.runnerNode.findUniqueOrThrow({
    where: { id: runner.id },
  });
  await manage({
    kind: 'runner',
    id: runner.id,
    expectedRevision: node.revision,
    status: 'DRAINING',
  });
  assert.equal(
    (
      await request('POST', 'runners/register', config.localRunnerToken, runner)
    ).json().status,
    'DRAINING',
  );
  const draining = await db.runnerNode.findUniqueOrThrow({
    where: { id: runner.id },
  });
  await manage({
    kind: 'runner',
    id: runner.id,
    expectedRevision: draining.revision,
    status: 'DISABLED',
  });
  assert.equal(
    (
      await request('POST', 'runners/register', config.localRunnerToken, runner)
    ).json().status,
    'DISABLED',
  );
  await db.runnerNode.update({
    where: { id: runner.id },
    data: { ownerSubject: 'another-identity' },
  });
  assert.equal(
    (await request('POST', 'runners/register', config.localRunnerToken, runner))
      .statusCode,
    403,
  );
  await manage({
    kind: 'pool',
    id: poolId,
    expectedRevision: 1,
    environment: 'local',
    region: 'test',
    minimumVersion: '1.2.0',
    status: 'DISABLED',
  });
  assert.equal(
    (
      await request('POST', 'runners/register', config.localRunnerToken, {
        ...runner,
        id: `${prefix}-new-node`,
      })
    ).statusCode,
    403,
  );
});
