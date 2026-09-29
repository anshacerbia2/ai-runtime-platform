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
import { PrismaRunnerDispatchRepository } from '../src/modules/control-plane/infrastructure/prisma-runner-dispatch.repository.js';
import { RunnerDispatchService } from '../src/modules/control-plane/application/runner-dispatch.service.js';
import { RunnerLivenessService } from '../src/modules/control-plane/application/runner-liveness.service.js';
import { PrismaRunnerLivenessRegistry } from '../src/modules/control-plane/infrastructure/prisma-runner-liveness.registry.js';
import { InMemoryRunnerPresenceStore } from '../src/modules/control-plane/infrastructure/in-memory-runner-presence.store.js';
import { PrismaRunnerAuthority } from '../src/modules/control-plane/infrastructure/prisma-runner-authority.js';

const config = loadConfig();
const database = createDatabaseClient(config);
const prefix = `dispatch-${randomUUID()}`;
const applicationId = `${prefix}-app`;
const connectionId = `${prefix}-connection`;
const profileRevisionId = randomUUID();
const executionId = randomUUID();
const envelopeId = randomUUID();
const bindingId = randomUUID();
const poolId = `${prefix}-pool`;
const runnerId = `${prefix}-runner`;
const ineligibleRunnerId = `${prefix}-runner-without-local-credential`;
const credentialId = `${prefix}-credential`;
let repository: PrismaDispatchEnvelopeRepository;
let control: M1ControlPlaneService;
let dispatch: RunnerDispatchService;
let liveness: RunnerLivenessService;
const presence = new InMemoryRunnerPresenceStore();
const principal: Principal = {
  subject: applicationId,
  kind: 'application',
  applicationId,
  roles: ['runtime-application'],
  scopes: ['execution:submit'],
};
const runnerPrincipal: Principal = {
  subject: `${prefix}-runner-owner`,
  kind: 'runner',
  roles: ['runtime-runner'],
  scopes: ['runner:register', 'runner:report'],
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
  await database.runnerPool.create({
    data: {
      id: poolId,
      environment: 'local',
      region: 'test',
      minimumVersion: '1.0.0',
    },
  });
  await database.runnerNode.create({
    data: {
      id: runnerId,
      ownerSubject: runnerPrincipal.subject,
      poolId,
      version: '1.0.0',
      capabilities: ['agent_execute'],
      connectionIds: [connectionId],
      capacity: 1,
    },
  });
  await database.runnerNode.create({
    data: {
      id: ineligibleRunnerId,
      ownerSubject: runnerPrincipal.subject,
      poolId,
      version: '1.0.0',
      capabilities: ['agent_execute'],
      connectionIds: [connectionId],
      capacity: 1,
    },
  });
  await database.credentialInstance.create({
    data: {
      id: credentialId,
      connectionId,
      residency: 'RUNNER_LOCAL',
      runnerRef: runnerId,
    },
  });
  repository = new PrismaDispatchEnvelopeRepository(
    database as unknown as DatabaseService,
  );
  control = new M1ControlPlaneService(
    new PrismaM1Repository(database as unknown as DatabaseService),
  );
  const registry = new PrismaRunnerLivenessRegistry(
    database as unknown as DatabaseService,
  );
  liveness = new RunnerLivenessService(registry, presence);
  dispatch = new RunnerDispatchService(
    registry,
    presence,
    new PrismaRunnerDispatchRepository(database as unknown as DatabaseService),
  );
});

after(async () => {
  await database.dispatchEnvelope.deleteMany({ where: { applicationId } });
  await database.runnerEvidence.deleteMany({
    where: { execution: { applicationId } },
  });
  await database.runnerAssignment.deleteMany({
    where: { execution: { applicationId } },
  });
  await database.outboxEvent.deleteMany({ where: { applicationId } });
  await database.auditEntry.deleteMany({ where: { applicationId } });
  await database.attempt.deleteMany({
    where: { execution: { applicationId } },
  });
  await database.execution.deleteMany({ where: { applicationId } });
  await database.admissionRateWindow.deleteMany({
    where: { scopeKey: { contains: prefix } },
  });
  await database.credentialInstance.deleteMany({
    where: { id: credentialId },
  });
  await database.credentialBinding.deleteMany({ where: { id: bindingId } });
  await database.profileAlias.deleteMany({ where: { applicationId } });
  await database.profileRevision.deleteMany({ where: { applicationId } });
  await database.aiConnection.deleteMany({ where: { id: connectionId } });
  await database.runnerNode.deleteMany({
    where: { id: { in: [runnerId, ineligibleRunnerId] } },
  });
  await database.runnerPool.deleteMany({ where: { id: poolId } });
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

test('current runner presence autonomously claims one policy-scoped dispatch grant', async () => {
  const nextEnvelopeId = randomUUID();
  const nextExecutionId = randomUUID();
  const nextDigest = randomBytes(32).toString('hex');
  await repository.createStaged({
    ...staged,
    envelopeId: nextEnvelopeId,
    executionBindingId: nextExecutionId,
    inputDigest: nextDigest,
    objectKey: `dispatch-envelopes/v1/${nextEnvelopeId}`,
  });
  await control.admitDispatchEnvelope(
    principal,
    { profileRef: `${prefix}-agent`, inputDigest: nextDigest },
    `${prefix}-automatic-dispatch`,
    { envelopeId: nextEnvelopeId, executionId: nextExecutionId },
  );

  const runner = await database.runnerNode.findUniqueOrThrow({
    where: { id: runnerId },
  });
  const bootId = randomUUID();
  const claim = {
    runnerId,
    bootId,
    registrationRevision: runner.revision,
  };
  await assert.rejects(
    dispatch.claim(runnerPrincipal, claim),
    (error) =>
      error instanceof ApplicationError &&
      error.code === 'STALE_RUNNER_REGISTRATION',
  );
  await liveness.heartbeat(runnerPrincipal, claim);
  await assert.rejects(
    dispatch.claim(runnerPrincipal, { ...claim, bootId: randomUUID() }),
    (error) =>
      error instanceof ApplicationError &&
      error.code === 'STALE_RUNNER_REGISTRATION',
  );

  const ineligibleRunner = await database.runnerNode.findUniqueOrThrow({
    where: { id: ineligibleRunnerId },
  });
  const ineligibleClaim = {
    runnerId: ineligibleRunnerId,
    bootId: randomUUID(),
    registrationRevision: ineligibleRunner.revision,
  };
  await liveness.heartbeat(runnerPrincipal, ineligibleClaim);
  assert.deepEqual(await dispatch.claim(runnerPrincipal, ineligibleClaim), {
    grant: null,
  });

  await database.credentialBinding.update({
    where: { id: bindingId },
    data: { status: 'DISABLED' },
  });
  assert.deepEqual(await dispatch.claim(runnerPrincipal, claim), {
    grant: null,
  });
  assert.equal(
    await database.runnerAssignment.count({
      where: { executionId: nextExecutionId },
    }),
    0,
  );
  await database.credentialBinding.update({
    where: { id: bindingId },
    data: { status: 'ENABLED' },
  });

  const claims = await Promise.all([
    dispatch.claim(runnerPrincipal, claim),
    dispatch.claim(runnerPrincipal, claim),
  ]);
  const grants = claims.flatMap((item) => (item.grant ? [item.grant] : []));
  assert.ok(grants.length >= 1);
  assert.equal(new Set(grants.map((item) => item.assignmentId)).size, 1);
  const grant = grants[0]!;
  assert.equal(grant.executionId, nextExecutionId);
  assert.equal(grant.runnerId, runnerId);
  assert.equal(grant.envelopeId, nextEnvelopeId);
  assert.equal(grant.inputDigest, nextDigest);
  assert.equal(grant.generation, 1);
  assert.equal(grant.state, 'GRANTED');
  assert.equal('objectKey' in grant, false);
  assert.equal('wrappedDataKey' in grant, false);

  const replay = await dispatch.claim(runnerPrincipal, claim);
  assert.equal(replay.grant?.assignmentId, grant.assignmentId);
  const authority = new PrismaRunnerAuthority(
    database as unknown as DatabaseService,
  );
  await assert.rejects(
    authority.report(runnerPrincipal, {
      type: 'started',
      token: {
        assignmentId: grant.assignmentId,
        executionId: grant.executionId,
        attemptId: grant.attemptId,
        runnerId: grant.runnerId,
        generation: grant.generation,
        epoch: grant.epoch,
      },
    }),
    (error) =>
      error instanceof ApplicationError && error.code === 'POLICY_DENIED',
  );
  assert.equal(
    (
      await database.runnerAssignment.findUniqueOrThrow({
        where: { id: grant.assignmentId },
      })
    ).state,
    'GRANTED',
  );
  assert.equal(
    (
      await database.execution.findUniqueOrThrow({
        where: { id: grant.executionId },
      })
    ).status,
    'ACCEPTED',
  );
  assert.equal(
    (
      await database.runnerAssignment.findUniqueOrThrow({
        where: { id: grant.assignmentId },
      })
    ).claimBootId,
    bootId,
  );
  const replacementBoot = { ...claim, bootId: randomUUID() };
  await liveness.heartbeat(runnerPrincipal, replacementBoot);
  assert.deepEqual(await dispatch.claim(runnerPrincipal, replacementBoot), {
    grant: null,
  });
  await assert.rejects(
    dispatch.claim(runnerPrincipal, claim),
    (error) =>
      error instanceof ApplicationError &&
      error.code === 'STALE_RUNNER_REGISTRATION',
  );
  assert.equal(
    await database.runnerAssignment.count({
      where: { executionId: nextExecutionId },
    }),
    1,
  );
  const event = await database.outboxEvent.findUniqueOrThrow({
    where: {
      topic_aggregateId_revision: {
        topic: 'runner.assignment-granted',
        aggregateId: grant.assignmentId,
        revision: 1,
      },
    },
  });
  const payload = JSON.stringify(event.payload);
  assert.equal(payload.includes('object_key'), false);
  assert.equal(payload.includes('wrapped_data_key'), false);
  assert.equal(payload.includes('plaintext'), false);
});
