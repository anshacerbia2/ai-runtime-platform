import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import type { InjectOptions } from 'fastify';
import { createApplication } from '../dist/bootstrap.js';
import { loadConfig } from '../src/infrastructure/config/environment-config.js';
import { createDatabaseClient } from '../src/infrastructure/database/client.js';
import { seedDatabase } from '../src/infrastructure/database/seed.js';
import { PrismaM1Repository } from '../src/modules/control-plane/infrastructure/prisma-m1.repository.js';
import { PrismaResourceReader } from '../src/modules/control-plane/infrastructure/prisma-resource-reader.js';
import type { DatabaseService } from '../src/infrastructure/database/database.service.js';
import { ManagementCommand } from '@ai-runtime/contracts';

const prefix = 'evolve-' + randomUUID();
const config = {
  ...loadConfig(),
  localOperatorToken: randomUUID(),
  localRunnerToken: randomUUID(),
  applications: [
    {
      id: prefix + '-app',
      name: 'Contract evolution fixture',
      token: randomUUID(),
    },
  ],
};
const db = createDatabaseClient(config);
const application = config.applications[0]!;
let app: Awaited<ReturnType<typeof createApplication>>;
let replica: typeof app;
const op = config.localOperatorToken;
const runnerToken = config.localRunnerToken;
const key = () => prefix + '-' + randomUUID();
function request(
  method: InjectOptions['method'],
  url: string,
  payload?: InjectOptions['payload'],
  requestKey?: string,
  token = op,
  server = app,
) {
  return server.inject({
    method,
    url,
    payload,
    headers: {
      host: config.apiHost + ':' + config.apiPort,
      authorization: 'Bearer ' + token,
      ...(requestKey ? { 'idempotency-key': requestKey } : {}),
      'x-runner-protocol': '1',
    },
  });
}
const connection = (label: string) => ({
  expectedRevision: 0,
  displayName: label,
  environment: 'local',
  provider: 'fixture',
  authMode: 'API_KEY',
  sharingMode: 'DEDICATED',
  quotaGroupRef: null,
  status: 'ENABLED',
});
async function put(
  resource: string,
  id: string,
  body: object,
  requestKey = key(),
) {
  const r = await request(
    'PUT',
    '/api/v1/' + resource + '/' + id,
    body,
    requestKey,
  );
  assert.equal(r.statusCode, 200, r.body);
  return r.json();
}
async function oldManage(body: object) {
  const r = await request('PUT', '/api/m1/control-plane', body);
  assert.equal(r.statusCode, 200, r.body);
  return r.json();
}

before(async () => {
  await seedDatabase(db, config);
  app = await createApplication(config);
  replica = await createApplication(config);
});
after(async () => {
  await Promise.all([app?.close(), replica?.close()]);
  const executionIds = (
    await db.execution.findMany({
      where: { applicationId: application.id },
      select: { id: true },
    })
  ).map((r) => r.id);
  const events = (
    await db.outboxEvent.findMany({
      where: { applicationId: application.id },
      select: { id: true },
    })
  ).map((r) => r.id);
  await db.inboxReceipt.deleteMany({ where: { eventId: { in: events } } });
  await db.runnerEvidence.deleteMany({
    where: { executionId: { in: executionIds } },
  });
  await db.runnerAssignment.deleteMany({
    where: { executionId: { in: executionIds } },
  });
  await db.outboxEvent.deleteMany({ where: { applicationId: application.id } });
  await db.ledgerEntry.deleteMany({
    where: { executionId: { in: executionIds } },
  });
  await db.usageObservation.deleteMany({
    where: { executionId: { in: executionIds } },
  });
  await db.artifactMetadata.deleteMany({
    where: { executionId: { in: executionIds } },
  });
  await db.reservation.deleteMany({
    where: { executionId: { in: executionIds } },
  });
  await db.attempt.deleteMany({ where: { executionId: { in: executionIds } } });
  await db.execution.deleteMany({ where: { applicationId: application.id } });
  await db.profileAlias.deleteMany({
    where: { applicationId: application.id },
  });
  await db.profileRevision.deleteMany({
    where: { applicationId: application.id },
  });
  await db.budgetProjection.deleteMany({
    where: { accountId: { startsWith: prefix } },
  });
  await db.budgetAccount.deleteMany({ where: { id: { startsWith: prefix } } });
  await db.credentialBinding.deleteMany({
    where: { applicationId: application.id },
  });
  await db.credentialInstance.deleteMany({
    where: { id: { startsWith: prefix } },
  });
  await db.runnerNode.deleteMany({ where: { id: { startsWith: prefix } } });
  await db.runnerPool.deleteMany({ where: { id: { startsWith: prefix } } });
  await db.aiConnection.deleteMany({ where: { id: { startsWith: prefix } } });
  await db.auditEntry.deleteMany({
    where: {
      OR: [
        { applicationId: application.id },
        { resourceId: { startsWith: prefix } },
      ],
    },
  });
  await db.managementReceipt.deleteMany({
    where: { requestKey: { startsWith: prefix } },
  });
  await db.controlApplication.deleteMany({ where: { id: application.id } });
  await db.profile.deleteMany({ where: { applicationId: application.id } });
  await db.application.deleteMany({ where: { id: application.id } });
  await db.$disconnect();
});

test('receipt atomically deduplicates concurrent management on two API instances', async () => {
  const id = prefix + '-race';
  const k = key();
  const body = connection('Race');
  const results = await Promise.all(
    Array.from({ length: 12 }, (_, i) =>
      request(
        'PUT',
        '/api/v1/connections/' + id,
        body,
        k,
        op,
        i % 2 ? replica : app,
      ),
    ),
  );
  assert.ok(
    results.every((r) => r.statusCode === 200),
    results.map((r) => r.body).join('\n'),
  );
  assert.equal(results.filter((r) => !r.json().receipt.replayed).length, 1);
  assert.equal(new Set(results.map((r) => r.json().receipt.id)).size, 1);
  assert.equal(await db.aiConnection.count({ where: { id } }), 1);
  assert.equal(await db.auditEntry.count({ where: { resourceId: id } }), 1);
  assert.equal(
    (
      await request(
        'PUT',
        '/api/v1/connections/' + id,
        { ...body, displayName: 'Changed' },
        k,
      )
    ).statusCode,
    409,
  );
});

test('lost acknowledgement replays before revision checking, while a new stale operation still conflicts', async () => {
  const id = prefix + '-lost';
  await put('connections', id, connection('Initial'));
  const body = { ...connection('Updated'), expectedRevision: 1 };
  const k = key();
  const first = await request('PUT', '/api/v1/connections/' + id, body, k);
  assert.equal(first.statusCode, 200, first.body);
  // The first acknowledgement is deliberately discarded; use the independent API instance.
  const replay = await request(
    'PUT',
    '/api/v1/connections/' + id,
    body,
    k,
    op,
    replica,
  );
  assert.equal(replay.statusCode, 200, replay.body);
  assert.equal(replay.json().receipt.replayed, true);
  assert.deepEqual(replay.json().resource, first.json().resource);
  assert.equal(replay.json().resource.revision, 2);
  assert.equal(
    (await request('PUT', '/api/v1/connections/' + id, body, key())).statusCode,
    409,
  );
  assert.equal(await db.auditEntry.count({ where: { resourceId: id } }), 2);
  await replica.close();
  replica = await createApplication(config);
  assert.equal(
    (
      await request('PUT', '/api/v1/connections/' + id, body, k, op, replica)
    ).json().receipt.id,
    first.json().receipt.id,
  );
});

test('receipt and mutation both roll back on a scoped database fault; incomplete receipts cannot commit', async () => {
  const id = prefix + '-rollback';
  const k = key();
  const name = 'receipt_fault_' + randomUUID().replaceAll('-', '');
  await db.$executeRawUnsafe(
    'CREATE FUNCTION control.' +
      name +
      "() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.resource_id = '" +
      id +
      "' THEN RAISE EXCEPTION 'Scoped receipt fault'; END IF; RETURN NEW; END $$",
  );
  await db.$executeRawUnsafe(
    'CREATE TRIGGER ' +
      name +
      ' AFTER INSERT ON control.audit_entries FOR EACH ROW EXECUTE FUNCTION control.' +
      name +
      '()',
  );
  try {
    assert.equal(
      (
        await request(
          'PUT',
          '/api/v1/connections/' + id,
          connection('Rollback'),
          k,
        )
      ).statusCode,
      503,
    );
    assert.equal(await db.aiConnection.count({ where: { id } }), 0);
    assert.equal(
      await db.managementReceipt.count({ where: { requestKey: k } }),
      0,
    );
  } finally {
    await db.$executeRawUnsafe(
      'DROP TRIGGER ' + name + ' ON control.audit_entries',
    );
    await db.$executeRawUnsafe('DROP FUNCTION control.' + name + '()');
  }
  await put('connections', id, connection('Rollback'), k);
  await assert.rejects(
    db.managementReceipt.create({
      data: {
        id: randomUUID(),
        scopeKey: 'a'.repeat(64),
        requestKey: key(),
        operation: 'invalid',
        requestDigest: 'b'.repeat(64),
        response: {},
        completed: false,
        expiresAt: new Date(Date.now() + 1000),
      },
    }),
  );
});

test('expired receipts retain token ownership, and unauthorized callers cannot replay', async () => {
  const id = prefix + '-expired';
  const k = key();
  await put('connections', id, connection('Expired'), k);
  await db.managementReceipt.updateMany({
    where: { requestKey: k },
    data: { expiresAt: new Date(0) },
  });
  const expired = await request(
    'PUT',
    '/api/v1/connections/' + id,
    connection('Expired'),
    k,
  );
  assert.equal(expired.statusCode, 410, expired.body);
  assert.equal(expired.json().error.code, 'REQUEST_KEY_EXPIRED');
  assert.equal(
    (
      await request(
        'PUT',
        '/api/v1/connections/' + id,
        connection('Expired'),
        k,
        application.token,
      )
    ).statusCode,
    403,
  );
  assert.equal(await db.auditEntry.count({ where: { resourceId: id } }), 1);
});

test('management receipt keys are caller scoped rather than globally replayable', async () => {
  const repository = new PrismaM1Repository(db as DatabaseService);
  const k = key();
  const a = {
    subject: prefix + '-operator-a',
    kind: 'operator' as const,
    roles: ['platform-admin'],
    scopes: ['platform:manage'],
  };
  const b = { ...a, subject: prefix + '-operator-b' };
  const first = await repository.manageReceipted(
    a,
    ManagementCommand.parse({
      ...connection('A'),
      kind: 'connection',
      id: prefix + '-scope-a',
    }),
    k,
  );
  const second = await repository.manageReceipted(
    b,
    ManagementCommand.parse({
      ...connection('B'),
      kind: 'connection',
      id: prefix + '-scope-b',
    }),
    k,
  );
  assert.notEqual(first.receipt.id, second.receipt.id);
  assert.equal(second.receipt.replayed, false);
});

test('keyset collections validate scope and UUID cursors, omit secret columns and outbox payload', async () => {
  for (let i = 0; i < 4; i++) {
    await put('connections', prefix + '-page-' + i, connection('Page ' + i));
  }
  const principal = {
    subject: 'local-operator',
    kind: 'operator' as const,
    roles: ['platform-admin'],
    scopes: ['platform:read'],
  };
  const scope = createHash('sha256')
    .update('operator:local-operator')
    .digest('hex');
  const cursor = (resource: string, after: string[], s = scope) =>
    Buffer.from(JSON.stringify({ v: 1, resource, scope: s, after })).toString(
      'base64url',
    );
  const first = await request(
    'GET',
    '/api/v1/connections?limit=2&cursor=' +
      cursor('connections', [prefix + '-page-']),
  );
  assert.equal(first.statusCode, 200, first.body);
  assert.equal(first.json().items.length, 2);
  assert.ok(first.json().nextCursor);
  const second = await request(
    'GET',
    '/api/v1/connections?limit=2&cursor=' + first.json().nextCursor,
  );
  assert.equal(second.statusCode, 200, second.body);
  assert.ok(
    second
      .json()
      .items.every((r: { id: string }) => r.id > first.json().items[1].id),
  );
  assert.equal(
    (
      await request(
        'GET',
        '/api/v1/credentials?cursor=' + first.json().nextCursor,
      )
    ).statusCode,
    400,
  );
  const reader = new PrismaResourceReader(db as DatabaseService);
  await assert.rejects(
    reader.list({ ...principal, subject: 'other' }, 'connections', {
      cursor: first.json().nextCursor,
    }),
    /cursor/i,
  );
  assert.equal(
    (
      await request(
        'GET',
        '/api/v1/audit?cursor=' + cursor('audit', ['not-a-uuid']),
      )
    ).statusCode,
    400,
  );
  assert.equal(
    (await request('GET', '/api/v1/connections?limit=101')).statusCode,
    400,
  );
  assert.equal(
    (
      await request(
        'GET',
        '/api/v1/connections',
        undefined,
        undefined,
        application.token,
      )
    ).statusCode,
    403,
  );
  const credentialId = prefix + '-credential';
  await put('credentials', credentialId, {
    expectedRevision: 0,
    connectionId: prefix + '-page-0',
    residency: 'CENTRAL',
    runnerRef: null,
    status: 'ENABLED',
  });
  await db.credentialInstance.update({
    where: { id: credentialId },
    data: { secretRef: 'vault://fixture-not-public' },
  });
  const creds = await request(
    'GET',
    '/api/v1/credentials?cursor=' + cursor('credentials', [prefix]),
  );
  assert.equal(creds.statusCode, 200);
  assert.doesNotMatch(creds.body, /secretRef|secret_ref|vault:\/\//);
  const eventId = '00000000-0000-4000-8000-' + randomUUID().slice(-12);
  await db.outboxEvent.create({
    data: {
      id: eventId,
      applicationId: application.id,
      topic: 'test.metadata-only',
      aggregateId: prefix,
      revision: 1,
      payload: { privateLargeContent: 'x'.repeat(256 * 1024) },
    },
  });
  const outbox = await request('GET', '/api/v1/outbox?limit=100');
  assert.equal(outbox.statusCode, 200, outbox.body);
  assert.doesNotMatch(outbox.body, /privateLargeContent|"payload"/);
  const overview = await request('GET', '/api/v1/overview');
  assert.equal(overview.statusCode, 200);
  assert.equal(overview.json().consistency, 'independent-observations');
  assert.ok(Buffer.byteLength(overview.body) < 4096);
  assert.equal('applications' in overview.json(), false);
});

async function runnerFixture(name: string) {
  const connectionId = prefix + '-' + name + '-connection';
  const poolId = prefix + '-' + name + '-pool';
  const runnerId = prefix + '-' + name + '-runner';
  const profileRef = prefix + '-' + name + '-profile';
  const budgetId = prefix + '-' + name + '-budget';
  await put('connections', connectionId, connection(name));
  await put('bindings', randomUUID(), {
    expectedRevision: 0,
    applicationId: application.id,
    connectionId,
    profileRef: null,
    status: 'ENABLED',
  });
  await put('budgets', budgetId, {
    expectedRevision: 0,
    applicationId: application.id,
    quotaGroupRef: null,
    unit: 'fixture',
    period: 'test',
    limitUnits: '10',
  });
  await put('pools', poolId, {
    expectedRevision: 0,
    environment: 'local',
    region: 'test',
    minimumVersion: '1.0.0',
    status: 'ENABLED',
  });
  const publish = await request(
    'POST',
    '/api/v1/applications/' +
      application.id +
      '/profiles/' +
      profileRef +
      '/revisions',
    {
      expectedRevision: 0,
      connectionId,
      capability: 'chat',
      holdUnits: '1',
      accountIds: [budgetId],
      enabled: true,
    },
    key(),
  );
  assert.equal(publish.statusCode, 200, publish.body);
  const registration = await request(
    'POST',
    '/api/m1/runners/register',
    {
      id: runnerId,
      poolId,
      version: '1.0.0',
      capabilities: ['chat'],
      connectionIds: [connectionId],
      capacity: 2,
    },
    undefined,
    runnerToken,
  );
  assert.equal(registration.statusCode, 201, registration.body);
  const admission = await request(
    'POST',
    '/api/m1/admissions',
    { profileRef, inputDigest: 'a'.repeat(64) },
    key(),
    application.token,
  );
  assert.equal(admission.statusCode, 201, admission.body);
  const executionId = admission.json().execution.id;
  const attempt = await db.attempt.findFirstOrThrow({ where: { executionId } });
  const grant = await request(
    'POST',
    '/api/v1/executions/' + executionId + '/assignments',
    {
      attemptId: attempt.id,
      runnerId,
      expectedGeneration: 0,
      protocolVersion: '1',
    },
    key(),
  );
  assert.equal(grant.statusCode, 200, grant.body);
  const {
    ownerSubject: _owner,
    state: _state,
    protocolVersion: _version,
    ...token
  } = grant.json();
  return {
    runnerId,
    poolId,
    executionId,
    attemptId: attempt.id,
    token,
    budgetId,
  };
}

test('runner report enforces owner, exact generation and epoch; revocation rejects zombie writes and retains late evidence', async () => {
  const f = await runnerFixture('fencing');
  const report = (token: object, type = 'started') =>
    request(
      'POST',
      '/api/runner/v1/reports',
      { type, token },
      undefined,
      runnerToken,
    );
  assert.equal((await report({ ...f.token, generation: 999 })).statusCode, 409);
  assert.equal((await report({ ...f.token, epoch: 2 })).statusCode, 409);
  assert.equal(
    (
      await request(
        'POST',
        '/api/runner/v1/reports',
        { type: 'started', token: f.token },
        undefined,
        application.token,
      )
    ).statusCode,
    403,
  );
  assert.equal((await report(f.token)).statusCode, 200);
  const revoke = await request(
    'POST',
    '/api/v1/executions/' + f.executionId + '/assignments/revoke',
    {
      assignmentId: f.token.assignmentId,
      generation: f.token.generation,
      reason: 'Fault recovery',
    },
    key(),
  );
  assert.equal(revoke.statusCode, 200, revoke.body);
  assert.equal((await report(f.token)).statusCode, 409);
  const next = await request(
    'POST',
    '/api/v1/executions/' + f.executionId + '/assignments',
    {
      attemptId: f.attemptId,
      runnerId: f.runnerId,
      expectedGeneration: 2,
      protocolVersion: '1',
    },
    key(),
  );
  assert.equal(next.statusCode, 200, next.body);
  assert.equal(next.json().generation, 3);
  assert.equal((await report(f.token)).statusCode, 409);
  const evidence = {
    token: f.token,
    evidence: {
      executionId: f.executionId,
      attemptId: f.attemptId,
      sourceEventId: 'late-1',
      sourceRevision: 1,
      coverage: ['call-1'],
      cumulativeUnits: '2',
      completeness: 'complete',
      costBasis: 'provider_reported',
      reason: 'Late fixture evidence',
    },
  };
  const first = await request(
    'POST',
    '/api/runner/v1/evidence',
    evidence,
    undefined,
    runnerToken,
  );
  assert.equal(first.statusCode, 202, first.body);
  assert.equal(first.json().state, 'QUARANTINED');
  assert.equal(first.json().stale, true);
  const replay = await request(
    'POST',
    '/api/runner/v1/evidence',
    evidence,
    undefined,
    runnerToken,
  );
  assert.equal(replay.json().id, first.json().id);
  assert.equal(replay.json().replayed, true);
  assert.equal(
    (
      await request(
        'POST',
        '/api/runner/v1/evidence',
        {
          ...evidence,
          evidence: { ...evidence.evidence, cumulativeUnits: '3' },
        },
        undefined,
        runnerToken,
      )
    ).statusCode,
    409,
  );
  assert.equal(
    await db.ledgerEntry.count({ where: { executionId: f.executionId } }),
    0,
  );
  assert.equal(
    (await db.budgetAccount.findUniqueOrThrow({ where: { id: f.budgetId } }))
      .postedUnits,
    0n,
  );
});

test('runner result proposals are idempotent, never fabricate completion, and remain fenced after API restart', async () => {
  const f = await runnerFixture('proposal');
  const proposal = {
    type: 'result.proposed',
    token: f.token,
    proposal: {
      outcome: 'completed',
      digest: 'c'.repeat(64),
      artifactIds: [],
      summary: 'Fixture output reference',
    },
  };
  assert.equal(
    (
      await request(
        'POST',
        '/api/runner/v1/reports',
        proposal,
        undefined,
        runnerToken,
      )
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await request(
        'POST',
        '/api/runner/v1/reports',
        { type: 'started', token: f.token },
        undefined,
        runnerToken,
      )
    ).statusCode,
    200,
  );
  const responses = await Promise.all(
    Array.from({ length: 6 }, (_, i) =>
      request(
        'POST',
        '/api/runner/v1/reports',
        proposal,
        undefined,
        runnerToken,
        i % 2 ? app : replica,
      ),
    ),
  );
  assert.ok(
    responses.every((r) => r.statusCode === 200),
    responses.map((r) => r.body).join('\n'),
  );
  assert.equal(
    await db.outboxEvent.count({
      where: {
        aggregateId: f.token.assignmentId,
        topic: 'runner.result-proposed',
      },
    }),
    1,
  );
  assert.equal(
    (await db.execution.findUniqueOrThrow({ where: { id: f.executionId } }))
      .status,
    'RUNNING',
  );
  assert.equal(
    (
      await request(
        'POST',
        '/api/runner/v1/reports',
        {
          ...proposal,
          proposal: { ...proposal.proposal, digest: 'd'.repeat(64) },
        },
        undefined,
        runnerToken,
      )
    ).statusCode,
    409,
  );
  await oldManage({
    kind: 'runner',
    id: f.runnerId,
    expectedRevision: 1,
    status: 'DISABLED',
  });
  await replica.close();
  replica = await createApplication(config);
  assert.equal(
    (
      await request(
        'POST',
        '/api/runner/v1/reports',
        proposal,
        undefined,
        runnerToken,
        replica,
      )
    ).statusCode,
    409,
  );
});

test('concurrent revoke and grant receipts advance the durable fence once per logical command', async () => {
  const f = await runnerFixture('concurrent-fence');
  const revokeKey = key();
  const revokeBody = {
    assignmentId: f.token.assignmentId,
    generation: f.token.generation,
    reason: 'Concurrent recovery fixture',
  };
  const revoked = await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      request(
        'POST',
        '/api/v1/executions/' + f.executionId + '/assignments/revoke',
        revokeBody,
        revokeKey,
        op,
        i % 2 ? app : replica,
      ),
    ),
  );
  assert.ok(
    revoked.every((r) => r.statusCode === 200),
    revoked.map((r) => r.body).join('\n'),
  );
  assert.equal(
    (await db.execution.findUniqueOrThrow({ where: { id: f.executionId } }))
      .assignmentGeneration,
    2,
  );
  assert.equal(
    await db.auditEntry.count({
      where: { resourceId: f.executionId, action: 'runner.assignment-fenced' },
    }),
    1,
  );
  const grantKey = key();
  const grantBody = {
    attemptId: f.attemptId,
    runnerId: f.runnerId,
    expectedGeneration: 2,
    protocolVersion: '1',
  };
  const grants = await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      request(
        'POST',
        '/api/v1/executions/' + f.executionId + '/assignments',
        grantBody,
        grantKey,
        op,
        i % 2 ? replica : app,
      ),
    ),
  );
  assert.ok(
    grants.every((r) => r.statusCode === 200),
    grants.map((r) => r.body).join('\n'),
  );
  assert.equal(new Set(grants.map((r) => r.json().assignmentId)).size, 1);
  assert.equal(grants[0]!.json().generation, 3);
  assert.equal(
    await db.runnerAssignment.count({ where: { executionId: f.executionId } }),
    2,
  );
  const staleResult = await request(
    'POST',
    '/api/runner/v1/reports',
    { type: 'started', token: f.token },
    undefined,
    runnerToken,
  );
  assert.equal(staleResult.statusCode, 409, staleResult.body);
});

test('a proposed result retains capacity until authority is resolved', async () => {
  const f = await runnerFixture('capacity');
  await db.runnerNode.update({
    where: { id: f.runnerId },
    data: { capacity: 1 },
  });
  const started = await request(
    'POST',
    '/api/runner/v1/reports',
    { type: 'started', token: f.token },
    undefined,
    runnerToken,
  );
  assert.equal(started.statusCode, 200, started.body);
  const proposed = await request(
    'POST',
    '/api/runner/v1/reports',
    {
      type: 'result.proposed',
      token: f.token,
      proposal: {
        outcome: 'completed',
        digest: 'e'.repeat(64),
        artifactIds: [],
        summary: 'Capacity remains reserved',
      },
    },
    undefined,
    runnerToken,
  );
  assert.equal(proposed.statusCode, 200, proposed.body);
  const execution = await db.execution.findUniqueOrThrow({
    where: { id: f.executionId },
  });
  const profile = await db.profileRevision.findUniqueOrThrow({
    where: { id: execution.profileRevisionId },
  });
  const accepted = await request(
    'POST',
    '/api/m1/admissions',
    { profileRef: profile.profileRef, inputDigest: 'f'.repeat(64) },
    key(),
    application.token,
  );
  assert.equal(accepted.statusCode, 201, accepted.body);
  const nextId = accepted.json().execution.id;
  const nextAttempt = await db.attempt.findFirstOrThrow({
    where: { executionId: nextId },
  });
  const rejected = await request(
    'POST',
    '/api/v1/executions/' + nextId + '/assignments',
    {
      attemptId: nextAttempt.id,
      runnerId: f.runnerId,
      expectedGeneration: 0,
      protocolVersion: '1',
    },
    key(),
  );
  assert.equal(rejected.statusCode, 429, rejected.body);
  assert.equal(
    await db.runnerAssignment.count({ where: { executionId: nextId } }),
    0,
  );
  assert.equal(
    (await db.execution.findUniqueOrThrow({ where: { id: f.executionId } }))
      .status,
    'RUNNING',
  );
});
