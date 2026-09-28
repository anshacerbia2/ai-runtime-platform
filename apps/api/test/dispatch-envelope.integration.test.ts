import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createDatabaseClient } from '../src/infrastructure/database/client.js';
import { loadConfig } from '../src/infrastructure/config/environment-config.js';
import type { DatabaseService } from '../src/infrastructure/database/database.service.js';
import { PrismaDispatchEnvelopeRepository } from '../src/modules/dispatch-envelope/infrastructure/prisma-dispatch-envelope.repository.js';
import { DispatchEnvelopeError } from '../src/modules/dispatch-envelope/application/dispatch-envelope.service.js';
import { PrismaM1Repository } from '../src/modules/control-plane/infrastructure/prisma-m1.repository.js';
import { M1ControlPlaneService } from '../src/modules/control-plane/application/m1-control-plane.service.js';
import type { Principal } from '../src/modules/identity/domain/principal.js';
import { ApplicationError } from '../src/shared/domain/application-error.js';

const config = loadConfig();
const database = createDatabaseClient(config);
const prefix = `dispatch-${randomUUID()}`;
const applicationId = `${prefix}-app`;
const connectionId = `${prefix}-connection`;
const profileRevisionId = randomUUID();
const executionId = randomUUID();
const envelopeId = randomUUID();
const bindingId = randomUUID();
let repository: PrismaDispatchEnvelopeRepository;
let control: M1ControlPlaneService;
const principal: Principal = {
  subject: applicationId,
  kind: 'application',
  applicationId,
  roles: ['runtime-application'],
  scopes: ['execution:submit'],
};

const staged = {
  envelopeId,
  applicationId,
  executionBindingId: executionId,
  profileRevisionId,
  inputDigest: randomBytes(32).toString('hex'),
  objectKey: `dispatch-envelopes/v1/${envelopeId}`,
  plaintextSha256: randomBytes(32).toString('hex'),
  ciphertextSha256: randomBytes(32).toString('hex'),
  plaintextBytes: 128,
  ciphertextBytes: 128,
  encryptionAlgorithm: 'AES-256-GCM' as const,
  keyProvider: 'ephemeral-test-only',
  keyReference: 'memory://dispatch-test-key/v1',
  wrappedDataKey: randomBytes(60),
  nonce: randomBytes(12),
  authenticationTag: randomBytes(16),
  retentionMs: 300_000,
};

before(async () => {
  await database.$connect();
  await database.controlApplication.create({
    data: {
      id: applicationId,
      displayName: 'Dispatch envelope fixture',
      environment: 'local',
      keycloakClientId: `${prefix}-client`,
    },
  });
  await database.aiConnection.create({
    data: {
      id: connectionId,
      displayName: 'Dispatch fixture connection',
      provider: 'fixture',
      authMode: 'WORKLOAD_IDENTITY',
      environment: 'local',
      sharingMode: 'DEDICATED',
    },
  });
  await database.profileRevision.create({
    data: {
      id: profileRevisionId,
      applicationId,
      profileRef: `${prefix}-agent`,
      revision: 1,
      connectionId,
      capability: 'agent_execute',
      providerAdapter: 'fixture',
      model: 'fixture-agent',
      maxOutputTokens: 256,
      timeoutMs: 10_000,
      streaming: true,
      holdUnits: 0n,
      accountIds: [],
      digest: randomBytes(32).toString('hex'),
    },
  });
  await database.profileAlias.create({
    data: {
      applicationId,
      profileRef: `${prefix}-agent`,
      revision: 1,
      enabled: true,
    },
  });
  await database.credentialBinding.create({
    data: {
      id: bindingId,
      applicationId,
      connectionId,
      profileRef: `${prefix}-agent`,
      status: 'ENABLED',
    },
  });
  repository = new PrismaDispatchEnvelopeRepository(
    database as unknown as DatabaseService,
  );
  control = new M1ControlPlaneService(
    new PrismaM1Repository(database as unknown as DatabaseService),
  );
});

after(async () => {
  await database.dispatchEnvelope.deleteMany({ where: { applicationId } });
  await database.outboxEvent.deleteMany({ where: { applicationId } });
  await database.attempt.deleteMany({
    where: { execution: { applicationId } },
  });
  await database.execution.deleteMany({ where: { applicationId } });
  await database.admissionRateWindow.deleteMany({
    where: { scopeKey: { contains: prefix } },
  });
  await database.credentialBinding.deleteMany({ where: { id: bindingId } });
  await database.profileAlias.deleteMany({ where: { applicationId } });
  await database.profileRevision.deleteMany({ where: { applicationId } });
  await database.aiConnection.deleteMany({ where: { id: connectionId } });
  await database.controlApplication.deleteMany({
    where: { id: applicationId },
  });
  await database.$disconnect();
});

test('admission atomically promotes one staged envelope before consume and expiry', async () => {
  const created = await repository.createStaged(staged);
  assert.equal(created.state, 'STAGED');
  assert.equal(created.executionId, null);
  assert.equal(created.revision, 1);

  await assert.rejects(
    control.admitDispatchEnvelope(
      principal,
      { profileRef: `${prefix}-agent`, inputDigest: staged.inputDigest },
      `${prefix}-wrong-binding`,
      { envelopeId, executionId: randomUUID() },
    ),
    (error) =>
      error instanceof ApplicationError &&
      error.code === 'IDEMPOTENCY_CONFLICT',
  );
  assert.equal(await database.execution.count({ where: { applicationId } }), 0);
  const afterRejected = await repository.find(envelopeId);
  assert.ok(afterRejected);
  assert.equal(afterRejected.state, 'STAGED');
  assert.equal(afterRejected.executionBindingId, executionId);
  assert.equal(afterRejected.profileRevisionId, profileRevisionId);
  assert.equal(afterRejected.inputDigest, staged.inputDigest);

  const admitted = await control.admitDispatchEnvelope(
    principal,
    { profileRef: `${prefix}-agent`, inputDigest: staged.inputDigest },
    `${prefix}-execution`,
    { envelopeId, executionId },
  );
  assert.equal(admitted.execution.id, executionId);
  assert.equal(admitted.replayed, false);
  assert.equal(
    (
      await database.execution.findUniqueOrThrow({
        where: { id: executionId },
        select: { admissionSource: true },
      })
    ).admissionSource,
    'AGENT',
  );
  const committed = await repository.find(envelopeId);
  assert.ok(committed);
  assert.equal(committed.state, 'COMMITTED');
  assert.equal(committed.executionId, executionId);
  assert.equal(committed.revision, 2);

  const replay = await control.admitDispatchEnvelope(
    principal,
    { profileRef: `${prefix}-agent`, inputDigest: staged.inputDigest },
    `${prefix}-execution`,
    { envelopeId, executionId },
  );
  assert.equal(replay.replayed, true);
  assert.equal(replay.execution.id, executionId);

  await assert.rejects(
    repository.consume(envelopeId, applicationId, 1),
    (error) =>
      error instanceof DispatchEnvelopeError &&
      error.code === 'ENVELOPE_CONFLICT',
  );
  const consumed = await repository.consume(envelopeId, applicationId, 2);
  assert.equal(consumed.state, 'CONSUMED');
  assert.equal(consumed.revision, 3);

  const row = await database.dispatchEnvelope.findUniqueOrThrow({
    where: { id: envelopeId },
  });
  await database.dispatchEnvelope.update({
    where: { id: envelopeId },
    data: { expiresAt: new Date(row.createdAt.getTime() + 1) },
  });
  const claimed = await repository.claimExpired(8);
  assert.equal(claimed.length, 1);
  assert.equal(claimed[0]!.state, 'DELETE_PENDING');
  assert.equal(claimed[0]!.revision, 4);
  assert.equal(await repository.markExpired(envelopeId, 4), true);
  assert.equal((await repository.find(envelopeId))?.state, 'EXPIRED');
  assert.equal(await repository.markExpired(envelopeId, 4), false);
});
