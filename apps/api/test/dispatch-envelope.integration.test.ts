import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createDatabaseClient } from '../src/infrastructure/database/client.js';
import { loadConfig } from '../src/infrastructure/config/environment-config.js';
import type { DatabaseService } from '../src/infrastructure/database/database.service.js';
import type { Prisma } from '../src/infrastructure/database/generated/client.js';
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
import { PrismaRunnerOutcomeAuthority } from '../src/modules/control-plane/infrastructure/prisma-runner-outcome.authority.js';
import { RunnerOutcomeService } from '../src/modules/control-plane/application/runner-outcome.service.js';
import { canonicalJson } from '@ai-runtime/contracts';
import { PrismaRunnerLeaseAuthority } from '../src/modules/control-plane/infrastructure/prisma-runner-lease.authority.js';
import { InMemoryRunnerLeaseStore } from '../src/modules/control-plane/infrastructure/in-memory-runner-lease.store.js';
import { RunnerLeaseService } from '../src/modules/control-plane/application/runner-lease.service.js';
import { RunnerAuthorityService } from '../src/modules/control-plane/application/runner-authority.service.js';
import { RunnerLeaseRecoveryService } from '../src/modules/control-plane/application/runner-lease-recovery.service.js';
import { PrismaRunnerLeaseRecoveryRepository } from '../src/modules/control-plane/infrastructure/prisma-runner-lease-recovery.repository.js';
import { ToolEffectService } from '../src/modules/tool-effects/application/tool-effect.service.js';
import type {
  ToolEffectRepository,
  ToolReceiverOutcome,
} from '../src/modules/tool-effects/application/tool-effect.port.js';
import { PrismaToolEffectRepository } from '../src/modules/tool-effects/infrastructure/prisma-tool-effect.repository.js';
import { Sha256ToolEffectDigester } from '../src/modules/tool-effects/infrastructure/sha256-tool-effect.digester.js';
import { PrismaDispatchPayloadAuthorization } from '../src/modules/dispatch-envelope/infrastructure/prisma-dispatch-payload.authorization.js';
import { PrismaRunnerPluginAuthorization } from '../src/modules/plugin-registry/infrastructure/prisma-runner-plugin.authorization.js';
import { SignedPluginPackageReader } from '../src/modules/plugin-registry/infrastructure/signed-plugin-package.reader.js';
import { PluginPackageDeliveryService } from '../src/modules/plugin-registry/application/plugin-package-delivery.service.js';
import { signedPluginFixture } from './fixtures/signed-plugin-package.js';
import { createApplication } from '../dist/bootstrap.js';
import {
  ToolOperationPage,
  ToolOperationStatus,
} from '@ai-runtime/contracts/http';

const config = loadConfig();
const database = createDatabaseClient(config);
const prefix = `dispatch-${randomUUID()}`;
const applicationId = `${prefix}-app`;
const connectionId = `${prefix}-connection`;
const profileRevisionId = randomUUID();
const pluginFixture = signedPluginFixture(applicationId, 'agent-fixture');
const pluginReader = new SignedPluginPackageReader(
  pluginFixture.store,
  pluginFixture.keys,
);
const pluginDigest = pluginFixture.record.bundleDigest;
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
let leaseService: RunnerLeaseService;
const leaseStore = new InMemoryRunnerLeaseStore();
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
  await database.pluginPackage.create({
    data: {
      applicationId,
      packageId: 'agent-fixture',
      version: '1.0.0',
      bundleDigest: pluginDigest,
      objectKey: pluginFixture.record.objectKey,
      bundleBytes: pluginFixture.record.bundleBytes,
      compatibleRuntimeVersions: ['claude-agent-sdk:0.3'],
      requiredPermissions: ['artifact:write'],
      state: 'ACTIVE',
      attestationRef: (await pluginReader.verify(pluginFixture.record))
        .attestationRef,
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
      pluginPackageId: 'agent-fixture',
      pluginVersion: '1.0.0',
      pluginDigest,
      pluginRuntimeVersion: 'claude-agent-sdk:0.3',
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
  leaseService = new RunnerLeaseService(
    registry,
    presence,
    leaseStore,
    new PrismaRunnerLeaseAuthority(database as unknown as DatabaseService),
  );
});

after(async () => {
  await database.dispatchEnvelope.deleteMany({ where: { applicationId } });
  await database.$executeRaw`DELETE FROM control.tool_effects WHERE application_id = ${applicationId}`;
  await database.runnerEvidence.deleteMany({
    where: { execution: { applicationId } },
  });
  await database.runnerStopReceipt.deleteMany({
    where: {
      executionId: {
        in: (
          await database.execution.findMany({
            where: { applicationId },
            select: { id: true },
          })
        ).map((row) => row.id),
      },
    },
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
    where: { runnerRef: { in: [runnerId, ineligibleRunnerId] } },
  });
  await database.credentialBinding.deleteMany({ where: { id: bindingId } });
  await database.profileAlias.deleteMany({ where: { applicationId } });
  await database.profileRevision.deleteMany({ where: { applicationId } });
  await database.pluginPackage.deleteMany({ where: { applicationId } });
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
  assert.deepEqual(grant.plugin, {
    packageId: 'agent-fixture',
    version: '1.0.0',
    bundleDigest: pluginDigest,
    runtimeVersion: 'claude-agent-sdk:0.3',
    requiredPermissions: ['artifact:write'],
  });
  assert.equal('objectKey' in grant, false);
  assert.equal('wrappedDataKey' in grant, false);

  const replay = await dispatch.claim(runnerPrincipal, claim);
  assert.equal(replay.grant?.assignmentId, grant.assignmentId);
  const authority = new PrismaRunnerAuthority(
    database as unknown as DatabaseService,
  );
  const token = {
    assignmentId: grant.assignmentId,
    executionId: grant.executionId,
    attemptId: grant.attemptId,
    runnerId: grant.runnerId,
    generation: grant.generation,
    epoch: grant.epoch,
  };
  await assert.rejects(
    authority.report(runnerPrincipal, {
      type: 'started',
      token,
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

  // Restore the original boot in the reference presence store to exercise its
  // still-current durable grant after the replacement-boot rejection above.
  await liveness.heartbeat(runnerPrincipal, claim);
  const recoveryRepository = new PrismaRunnerLeaseRecoveryRepository(
    database as unknown as DatabaseService,
  );
  await database.runnerAssignment.update({
    where: { id: grant.assignmentId },
    data: { updatedAt: new Date(Date.now() - 31_000) },
  });
  const staleScan = (await recoveryRepository.scan(null, 64)).find(
    (candidate) => candidate.assignmentId === grant.assignmentId,
  );
  assert.ok(staleScan);
  assert.equal(staleScan.proof, null);
  const firstNonce = randomBytes(32).toString('base64url');
  const secondNonce = randomBytes(32).toString('base64url');
  const activations = await Promise.allSettled([
    leaseService.activate(runnerPrincipal, {
      bootId,
      registrationRevision: runner.revision,
      nonce: firstNonce,
      token,
    }),
    leaseService.activate(runnerPrincipal, {
      bootId,
      registrationRevision: runner.revision,
      nonce: secondNonce,
      token,
    }),
  ]);
  assert.equal(
    activations.filter((activation) => activation.status === 'fulfilled')
      .length,
    1,
  );
  const nonce =
    activations[0]!.status === 'fulfilled' ? firstNonce : secondNonce;
  const lease = { bootId, registrationRevision: runner.revision, nonce };
  const leaseCommand = { ...lease, token };
  assert.deepEqual(await leaseService.activate(runnerPrincipal, leaseCommand), {
    state: 'ACTIVE',
    leaseTtlMs: 15_000,
    renewIntervalMs: 5_000,
  });
  const payloadAuthorization = new PrismaDispatchPayloadAuthorization(
    database as unknown as DatabaseService,
    leaseService,
  );
  assert.deepEqual(
    await payloadAuthorization.assertCurrent(
      runnerPrincipal,
      leaseCommand,
      nextEnvelopeId,
    ),
    { applicationId },
  );
  const pluginAuthorization = new PrismaRunnerPluginAuthorization(
    database as unknown as DatabaseService,
    payloadAuthorization,
  );
  const pinnedPlugin = await pluginAuthorization.assertCurrent(
    runnerPrincipal,
    leaseCommand,
    nextEnvelopeId,
  );
  assert.equal(pinnedPlugin.applicationId, applicationId);
  assert.equal(pinnedPlugin.packageId, 'agent-fixture');
  assert.equal(pinnedPlugin.bundleDigest, pluginDigest);
  const pluginDelivery = new PluginPackageDeliveryService(
    pluginAuthorization,
    pluginReader,
  );
  assert.deepEqual(
    Buffer.from(
      await pluginDelivery.read(runnerPrincipal, leaseCommand, nextEnvelopeId),
    ),
    pluginFixture.bytes,
  );
  await assert.rejects(
    pluginAuthorization.assertCurrent(
      { ...runnerPrincipal, subject: 'another-owner' },
      leaseCommand,
      nextEnvelopeId,
    ),
    ApplicationError,
  );
  await assert.rejects(
    payloadAuthorization.assertCurrent(
      runnerPrincipal,
      leaseCommand,
      envelopeId,
    ),
    (error) =>
      error instanceof ApplicationError && error.code === 'STALE_ASSIGNMENT',
  );
  assert.equal(
    (
      await database.runnerAssignment.findUniqueOrThrow({
        where: { id: grant.assignmentId },
      })
    ).leaseNonceDigest?.trim(),
    createHash('sha256').update(nonce).digest('hex'),
  );
  assert.equal(
    await recoveryRepository.fence(staleScan, 'ACTIVATION_TIMEOUT'),
    false,
  );
  await leaseService.activate(runnerPrincipal, leaseCommand);
  await assert.rejects(
    leaseService.activate(runnerPrincipal, {
      ...leaseCommand,
      nonce: randomBytes(32).toString('base64url'),
    }),
    (error) =>
      error instanceof ApplicationError && error.code === 'STALE_ASSIGNMENT',
  );
  const reports = new RunnerAuthorityService(authority, leaseService);
  await assert.rejects(
    reports.report(runnerPrincipal, {
      type: 'started',
      token,
      lease: { ...lease, nonce: randomBytes(32).toString('base64url') },
    }),
    (error) =>
      error instanceof ApplicationError && error.code === 'STALE_ASSIGNMENT',
  );
  assert.equal(
    (await reports.report(runnerPrincipal, { type: 'started', token, lease }))
      .state,
    'STARTED',
  );
  const proposal = {
    outcome: 'completed' as const,
    digest: 'a'.repeat(64),
    artifactIds: [],
    summary: '',
  };
  assert.equal(
    (
      await reports.report(runnerPrincipal, {
        type: 'result.proposed',
        token,
        lease,
        proposal,
      })
    ).state,
    'RESULT_PROPOSED',
  );
  const proof = {
    ...token,
    ownerSubject: runnerPrincipal.subject,
    nonce,
  };
  const recovery = new RunnerLeaseRecoveryService(
    recoveryRepository,
    leaseStore,
  );
  await database.runnerAssignment.update({
    where: { id: grant.assignmentId },
    data: { updatedAt: new Date(Date.now() - 31_000) },
  });
  assert.equal(await recovery.recover(), 0);
  assert.equal(
    (
      await database.runnerAssignment.findUniqueOrThrow({
        where: { id: grant.assignmentId },
      })
    ).state,
    'RESULT_PROPOSED',
  );
  assert.equal(await leaseStore.release(proof), 'RELEASED');
  await assert.rejects(
    leaseService.activate(runnerPrincipal, leaseCommand),
    (error) =>
      error instanceof ApplicationError && error.code === 'STALE_ASSIGNMENT',
  );
  await assert.rejects(
    reports.report(runnerPrincipal, {
      type: 'result.proposed',
      token,
      lease,
      proposal,
    }),
    (error) =>
      error instanceof ApplicationError && error.code === 'STALE_ASSIGNMENT',
  );
  assert.equal(
    (
      await database.runnerAssignment.findUniqueOrThrow({
        where: { id: grant.assignmentId },
      })
    ).state,
    'RESULT_PROPOSED',
  );
  const held = await database.reservation.findMany({
    where: { executionId: grant.executionId },
  });
  assert.equal(await recovery.recover(), 1);
  assert.equal(await recovery.recover(), 0);
  assert.equal(
    (
      await database.runnerAssignment.findUniqueOrThrow({
        where: { id: grant.assignmentId },
      })
    ).state,
    'FENCED',
  );
  await assert.rejects(
    payloadAuthorization.assertCurrent(
      runnerPrincipal,
      leaseCommand,
      nextEnvelopeId,
    ),
    (error) =>
      error instanceof ApplicationError && error.code === 'STALE_ASSIGNMENT',
  );
  assert.deepEqual(
    (
      await database.runnerAssignment.findUniqueOrThrow({
        where: { id: grant.assignmentId },
      })
    ).proposal,
    proposal,
  );
  const suspended = await database.attempt.findUniqueOrThrow({
    where: { id: grant.attemptId },
  });
  assert.equal(suspended.status, 'ORPHAN_SUSPENDED');
  assert.equal(suspended.authority, 'FENCED');
  assert.equal(suspended.compute, 'UNKNOWN');
  assert.equal(suspended.external, 'UNKNOWN');
  const reconciling = await database.execution.findUniqueOrThrow({
    where: { id: grant.executionId },
  });
  assert.equal(reconciling.status, 'RECONCILING');
  assert.equal(reconciling.assignmentGeneration, grant.generation + 1);
  const retained = await database.reservation.findMany({
    where: { executionId: grant.executionId },
  });
  assert.deepEqual(
    retained.map(({ accountId, heldUnits, state }) => ({
      accountId,
      heldUnits,
      state,
    })),
    held.map(({ accountId, heldUnits }) => ({
      accountId,
      heldUnits,
      state: 'PENDING_RECONCILIATION',
    })),
  );
  await assert.rejects(
    authority.report(runnerPrincipal, { type: 'started', token, lease }),
    (error) =>
      error instanceof ApplicationError && error.code === 'STALE_ASSIGNMENT',
  );
  const fencedEvent = await database.outboxEvent.findUniqueOrThrow({
    where: {
      topic_aggregateId_revision: {
        topic: 'runner.assignment-orphan-suspended',
        aggregateId: grant.assignmentId,
        revision: 1,
      },
    },
  });
  assert.equal(JSON.stringify(fencedEvent.payload).includes(nonce), false);
});

test('tool-effect recovery avoids duplicate mutation before epoch fences a live lease', async (t) => {
  const nextEnvelopeId = randomUUID();
  const nextExecutionId = randomUUID();
  const inputDigest = randomBytes(32).toString('hex');
  await repository.createStaged({
    ...staged,
    envelopeId: nextEnvelopeId,
    executionBindingId: nextExecutionId,
    inputDigest,
    objectKey: `dispatch-envelopes/v1/${nextEnvelopeId}`,
  });
  await control.admitDispatchEnvelope(
    principal,
    { profileRef: `${prefix}-agent`, inputDigest },
    `${prefix}-epoch-recovery`,
    { envelopeId: nextEnvelopeId, executionId: nextExecutionId },
  );
  const runner = await database.runnerNode.findUniqueOrThrow({
    where: { id: runnerId },
  });
  const bootId = randomUUID();
  const heartbeat = {
    runnerId,
    bootId,
    registrationRevision: runner.revision,
  };
  await liveness.heartbeat(runnerPrincipal, heartbeat);
  const grant = (await dispatch.claim(runnerPrincipal, heartbeat)).grant;
  assert.ok(grant);
  const token = {
    assignmentId: grant.assignmentId,
    executionId: grant.executionId,
    attemptId: grant.attemptId,
    runnerId: grant.runnerId,
    generation: grant.generation,
    epoch: grant.epoch,
  };
  const nonce = randomBytes(32).toString('base64url');
  const lease = { bootId, registrationRevision: runner.revision, nonce };
  await leaseService.activate(runnerPrincipal, { token, ...lease });
  const authority = new PrismaRunnerAuthority(
    database as unknown as DatabaseService,
  );
  const reports = new RunnerAuthorityService(authority, leaseService);
  assert.equal(
    (await reports.report(runnerPrincipal, { type: 'started', token, lease }))
      .state,
    'STARTED',
  );
  const effects = new PrismaToolEffectRepository(
    database as unknown as DatabaseService,
    false,
  );
  const digester = new Sha256ToolEffectDigester();
  const input = Buffer.from('synthetic approved tool mutation');
  const intent = {
    applicationId,
    operationId: randomUUID(),
    executionId: grant.executionId,
    assignmentId: grant.assignmentId,
    attemptId: grant.attemptId,
    generation: grant.generation,
    epoch: grant.epoch,
    toolRef: 'fixture:mutate',
    requestDigest: createHash('sha256').update(input).digest('hex'),
    receiverRetentionUntil: new Date(Date.now() + 60_000),
  };
  const committed: ToolReceiverOutcome = {
    state: 'COMMITTED',
    receiptRef: `receipt:${randomUUID()}`,
    receiptDigest: randomBytes(32).toString('hex'),
  };
  let invoked = 0;
  let statusChecks = 0;
  let statusAvailable = false;
  const receiverKeys: string[] = [];
  const receiver = {
    async invoke(key: string) {
      receiverKeys.push(key);
      invoked += 1;
      return committed;
    },
    async checkStatus(key: string) {
      receiverKeys.push(key);
      statusChecks += 1;
      return statusAvailable ? committed : { state: 'UNKNOWN' as const };
    },
  };
  let loseReceipt = true;
  const interrupted: ToolEffectRepository = {
    prepare: (command) => effects.prepare(command),
    claim: (command) => effects.claim(command),
    recordOutcome: (command, outcome) => {
      if (loseReceipt) {
        loseReceipt = false;
        throw new Error('synthetic crash after receiver commit');
      }
      return effects.recordOutcome(command, outcome);
    },
  };
  await assert.rejects(
    new ToolEffectService(interrupted, digester).execute(
      intent,
      input,
      receiver,
    ),
    /synthetic crash after receiver commit/,
  );
  assert.equal(invoked, 1);
  const broker = new ToolEffectService(effects, digester);
  assert.equal(
    (await broker.execute(intent, input, receiver)).state,
    'UNKNOWN',
  );
  assert.equal(invoked, 1);
  statusAvailable = true;
  assert.equal(
    (await broker.execute(intent, input, receiver)).state,
    'COMMITTED',
  );
  assert.equal(
    (await broker.execute(intent, input, receiver)).state,
    'COMMITTED',
  );
  assert.equal(invoked, 1);
  assert.equal(statusChecks, 2);
  assert.equal(new Set(receiverKeys).size, 1);
  assert.notEqual(receiverKeys[0], intent.operationId);
  const concurrentIntent = { ...intent, operationId: randomUUID() };
  let concurrentInvokes = 0;
  const concurrentReceiver = {
    async invoke() {
      concurrentInvokes += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return committed;
    },
    async checkStatus() {
      return { state: 'UNKNOWN' as const };
    },
  };
  const concurrent = await Promise.all([
    broker.execute(concurrentIntent, input, concurrentReceiver),
    broker.execute(concurrentIntent, input, concurrentReceiver),
  ]);
  assert.equal(concurrentInvokes, 1);
  assert.ok(concurrent.some((result) => result.state === 'COMMITTED'));
  assert.equal(
    (await broker.execute(concurrentIntent, input, concurrentReceiver)).state,
    'COMMITTED',
  );
  const noEffectIntent = { ...intent, operationId: randomUUID() };
  await effects.prepare(noEffectIntent);
  assert.equal(await effects.claim(noEffectIntent), true);
  await effects.recordOutcome(noEffectIntent, {
    ...committed,
    state: 'NO_EFFECT',
  });
  const unsettled = [];
  for (const state of ['PREPARED', 'DISPATCHING', 'UNKNOWN'] as const) {
    const pending = { ...intent, operationId: randomUUID() };
    await effects.prepare(pending);
    if (state !== 'PREPARED') {
      await effects.claim(pending);
    }
    if (state === 'UNKNOWN') {
      await effects.recordOutcome(pending, { state });
    }
    unsettled.push({ operationId: pending.operationId, state });
  }
  const altered = Buffer.from('different mutation');
  await assert.rejects(
    broker.execute(
      {
        ...intent,
        requestDigest: createHash('sha256').update(altered).digest('hex'),
      },
      altered,
      receiver,
    ),
    (error) =>
      error instanceof ApplicationError &&
      error.code === 'IDEMPOTENCY_CONFLICT',
  );
  await assert.rejects(
    broker.execute(
      { ...intent, applicationId: `${applicationId}-other` },
      input,
      receiver,
    ),
    (error) =>
      error instanceof ApplicationError && error.code === 'STALE_ASSIGNMENT',
  );
  await assert.rejects(
    broker.execute(
      {
        ...intent,
        operationId: randomUUID(),
        receiverRetentionUntil: new Date(Date.now() - 1_000),
      },
      input,
      receiver,
    ),
    (error) =>
      error instanceof ApplicationError && error.code === 'INVALID_REQUEST',
  );
  const recovery = new PrismaRunnerLeaseRecoveryRepository(
    database as unknown as DatabaseService,
  );
  const candidate = (await recovery.scanActive(64)).find(
    (row) => row.assignmentId === grant.assignmentId,
  );
  assert.ok(candidate);
  assert.equal(await recovery.fence(candidate, 'EPOCH_LOST'), true);
  assert.equal(await recovery.fence(candidate, 'EPOCH_LOST'), false);
  const appToken = randomUUID();
  const foreignToken = randomUUID();
  const httpConfig = {
    ...config,
    localOperatorToken: randomUUID(),
    localRunnerToken: randomUUID(),
    applications: [
      { id: applicationId, name: 'Tool status owner', token: appToken },
      {
        id: `${prefix}-foreign`,
        name: 'Foreign tool status caller',
        token: foreignToken,
      },
    ],
  };
  const apiA = await createApplication(httpConfig);
  t.after(() => apiA.close());
  const apiB = await createApplication(httpConfig);
  t.after(() => apiB.close());
  await database.controlApplication.create({
    data: {
      id: `${prefix}-foreign`,
      displayName: 'Foreign tool status caller',
      environment: 'local',
      keycloakClientId: `${prefix}-foreign-client`,
    },
  });
  t.after(() =>
    database.controlApplication
      .deleteMany({ where: { id: `${prefix}-foreign` } })
      .then(() => undefined),
  );
  await database.application.createMany({
    data: httpConfig.applications.map((app) => ({
      id: app.id,
      displayName: app.name,
      tokenSha256: createHash('sha256').update(app.token).digest('hex'),
    })),
  });
  t.after(() =>
    database.application
      .deleteMany({
        where: { id: { in: httpConfig.applications.map((app) => app.id) } },
      })
      .then(() => undefined),
  );
  const basePath = `/v1/executions/${intent.executionId}/tool-operations`;
  const read = (path: string, token: string = appToken, server = apiA) =>
    server.inject({
      method: 'GET',
      url: path,
      headers: {
        host: `${config.apiHost}:${config.apiPort}`,
        authorization: `Bearer ${token}`,
      },
    });
  const status = async (
    operationId: string,
    expected: string,
    server = apiA,
  ) => {
    const response = await read(`${basePath}/${operationId}`, appToken, server);
    assert.equal(response.statusCode, 200, response.body);
    const result = ToolOperationStatus.parse(response.json());
    assert.equal(result.state, expected);
    assert.equal(result.executionId, intent.executionId);
    assert.equal(result.operationId, operationId);
    assert.deepEqual(
      Object.keys(response.json()).sort(),
      [
        'operationId',
        'executionId',
        'toolRef',
        'requestDigest',
        'state',
        'receipt',
        'receiverRetentionUntil',
        'updatedAt',
      ].sort(),
    );
    return result;
  };
  const committedStatus = await status(intent.operationId, 'COMMITTED', apiB);
  assert.deepEqual(committedStatus.receipt, {
    ref: committed.receiptRef,
    digest: committed.receiptDigest,
  });
  for (const pending of unsettled) {
    await status(pending.operationId, pending.state, apiB);
  }
  assert.equal((await read(`${basePath}/${randomUUID()}`)).statusCode, 404);
  const empty = await read(`/v1/executions/${executionId}/tool-operations`);
  assert.equal(empty.statusCode, 200, empty.body);
  assert.deepEqual(ToolOperationPage.parse(empty.json()).items, []);
  await status(noEffectIntent.operationId, 'NO_EFFECT', apiB);
  const expectedIds = [
    intent.operationId,
    concurrentIntent.operationId,
    noEffectIntent.operationId,
    ...unsettled.map((item) => item.operationId),
  ].sort();
  const seen: string[] = [];
  let after: string | null = null;
  do {
    const response = await read(
      `${basePath}?limit=1${after ? `&after=${after}` : ''}`,
      appToken,
      apiB,
    );
    assert.equal(response.statusCode, 200, response.body);
    const page = ToolOperationPage.parse(response.json());
    assert.equal(page.limit, 1);
    seen.push(...page.items.map((item) => item.operationId));
    after = page.nextAfter;
  } while (after);
  assert.deepEqual(seen, expectedIds);
  // A cursor is only a keyset boundary; it cannot change execution/application scope.
  assert.deepEqual(
    (
      await read(
        `/v1/executions/${executionId}/tool-operations?after=${intent.operationId}`,
      )
    ).json().items,
    [],
  );
  for (const token of [
    httpConfig.localOperatorToken,
    httpConfig.localRunnerToken,
  ]) {
    assert.equal((await read(basePath, token)).statusCode, 403);
    assert.equal(
      (await read(`${basePath}/${intent.operationId}`, token)).statusCode,
      403,
    );
  }
  assert.equal((await read(basePath, '')).statusCode, 401);
  for (const path of [basePath, `${basePath}/${intent.operationId}`]) {
    const foreign = await read(path, foreignToken);
    const missing = await read(path.replace(intent.executionId, randomUUID()));
    assert.equal(foreign.statusCode, 404);
    assert.equal(missing.statusCode, 404);
    assert.deepEqual(
      { ...foreign.json().error, request_id: undefined },
      { ...missing.json().error, request_id: undefined },
    );
  }
  assert.equal(
    (
      await read(
        `/v1/executions/${executionId}/tool-operations/${intent.operationId}`,
      )
    ).statusCode,
    404,
  );
  for (const query of [
    'limit=0',
    'limit=101',
    'limit=1&limit=2',
    'after=bad',
    'application_id=other',
  ]) {
    assert.equal((await read(`${basePath}?${query}`)).statusCode, 400);
  }
  assert.equal(
    (await read(`${basePath}/${intent.operationId}?application_id=other`))
      .statusCode,
    400,
  );
  assert.equal((await read(`${basePath}/invalid`)).statusCode, 400);
  // Fencing and elapsed receiver retention never erase an already-observed effect.
  await database.toolEffect.updateMany({
    where: { applicationId, executionId: intent.executionId },
    data: { receiverRetentionUntil: new Date(Date.now() - 1_000) },
  });
  const snapshot = async () => ({
    execution: await database.execution.findUniqueOrThrow({
      where: { id: intent.executionId },
    }),
    attempt: await database.attempt.findUniqueOrThrow({
      where: { id: intent.attemptId },
    }),
    effects: await database.toolEffect.findMany({
      where: { executionId: intent.executionId },
      orderBy: { operationId: 'asc' },
    }),
    reservations: await database.reservation.findMany({
      where: { executionId: intent.executionId },
    }),
    ledger: await database.ledgerEntry.count({
      where: { executionId: intent.executionId },
    }),
    observations: await database.usageObservation.count({
      where: { executionId: intent.executionId },
    }),
    audit: await database.auditEntry.count({ where: { applicationId } }),
    outbox: await database.outboxEvent.count({ where: { applicationId } }),
  });
  const beforeReads = await snapshot();
  await status(intent.operationId, 'COMMITTED', apiA);
  for (const pending of unsettled) {
    await status(pending.operationId, pending.state, apiB);
  }
  const recoveredPage = await read(basePath, appToken, apiB);
  assert.equal(recoveredPage.statusCode, 200, recoveredPage.body);
  assert.equal(ToolOperationPage.parse(recoveredPage.json()).items.length, 6);
  assert.deepEqual(await snapshot(), beforeReads);
  assert.equal(invoked, 1);
  assert.equal(statusChecks, 2);
  await assert.rejects(
    broker.execute({ ...intent, operationId: randomUUID() }, input, receiver),
    (error) =>
      error instanceof ApplicationError && error.code === 'STALE_ASSIGNMENT',
  );
  assert.equal(
    (
      await database.execution.findUniqueOrThrow({
        where: { id: grant.executionId },
      })
    ).status,
    'RECONCILING',
  );
  await assert.rejects(
    authority.report(runnerPrincipal, { type: 'started', token, lease }),
    (error) =>
      error instanceof ApplicationError && error.code === 'STALE_ASSIGNMENT',
  );
  assert.equal(
    await leaseStore.release({
      ...token,
      ownerSubject: runnerPrincipal.subject,
      nonce,
    }),
    'RELEASED',
  );
});

test('durable cancel denies renew/proposal while late evidence remains quarantined and deduplicated', async () => {
  for (const cancelFirst of [true, false]) {
    const nextEnvelopeId = randomUUID();
    const nextExecutionId = randomUUID();
    const inputDigest = randomBytes(32).toString('hex');
    await repository.createStaged({
      ...staged,
      envelopeId: nextEnvelopeId,
      executionBindingId: nextExecutionId,
      inputDigest,
      objectKey: `dispatch-envelopes/v1/${nextEnvelopeId}`,
    });
    await control.admitDispatchEnvelope(
      principal,
      { profileRef: `${prefix}-agent`, inputDigest },
      `${prefix}-cancel-${cancelFirst}`,
      { envelopeId: nextEnvelopeId, executionId: nextExecutionId },
    );
    const runner = await database.runnerNode.findUniqueOrThrow({
      where: { id: runnerId },
    });
    const heartbeat = {
      runnerId,
      bootId: randomUUID(),
      registrationRevision: runner.revision,
    };
    await liveness.heartbeat(runnerPrincipal, heartbeat);
    const grant = (await dispatch.claim(runnerPrincipal, heartbeat)).grant;
    assert.ok(grant);
    assert.equal(grant.executionId, nextExecutionId);
    const token = {
      assignmentId: grant.assignmentId,
      executionId: grant.executionId,
      attemptId: grant.attemptId,
      runnerId: grant.runnerId,
      generation: grant.generation,
      epoch: grant.epoch,
    };
    const lease = {
      bootId: heartbeat.bootId,
      registrationRevision: heartbeat.registrationRevision,
      nonce: randomBytes(32).toString('base64url'),
    };
    await leaseService.activate(runnerPrincipal, { token, ...lease });
    const reports = new RunnerAuthorityService(
      new PrismaRunnerAuthority(database as unknown as DatabaseService),
      leaseService,
    );
    await reports.report(runnerPrincipal, { type: 'started', token, lease });
    const outcomes = new RunnerOutcomeService(
      new PrismaRunnerOutcomeAuthority(database as unknown as DatabaseService),
    );
    const outcomeBinding = {
      token,
      bootId: heartbeat.bootId,
      registrationRevision: heartbeat.registrationRevision,
    };
    const absent = await outcomes.reconcileResult(runnerPrincipal, {
      ...outcomeBinding,
      proposalDigest: 'b'.repeat(64),
    });
    assert.equal(absent.state, 'NOT_RECORDED');
    const proposal = {
      type: 'result.proposed' as const,
      token,
      lease,
      proposal: {
        outcome: 'completed' as const,
        digest: 'a'.repeat(64),
        artifactIds: [],
        summary: 'fixture result',
      },
    };
    if (!cancelFirst) {
      assert.equal(
        (await reports.report(runnerPrincipal, proposal)).state,
        'RESULT_PROPOSED',
      );
      assert.equal(
        (
          await database.execution.findUniqueOrThrow({
            where: { id: nextExecutionId },
          })
        ).status,
        'RUNNING',
      );
    }
    await control.cancelExecution(
      { ...principal, scopes: ['execution:cancel', 'execution:read'] },
      nextExecutionId,
      'fixture cancel',
    );
    const proposalDigest = createHash('sha256')
      .update(canonicalJson(proposal.proposal))
      .digest('hex');
    const reconciled = await outcomes.reconcileResult(runnerPrincipal, {
      ...outcomeBinding,
      proposalDigest,
    });
    assert.equal(reconciled.state, cancelFirst ? 'NOT_RECORDED' : 'MATCHED');
    assert.equal(reconciled.stale, true);
    if (!cancelFirst) {
      assert.equal(
        (
          await outcomes.reconcileResult(runnerPrincipal, {
            ...outcomeBinding,
            proposalDigest: 'b'.repeat(64),
          })
        ).state,
        'CONFLICT',
      );
    }
    const stopReport = {
      ...outcomeBinding,
      evidence: { state: 'UNCONFIRMED' as const, method: null },
    };
    const originalRevision = (
      await database.runnerAssignment.findUniqueOrThrow({
        where: { id: token.assignmentId },
      })
    ).claimRegistrationRevision;
    assert.equal(originalRevision, heartbeat.registrationRevision);
    await assert.rejects(
      outcomes.stop({ ...runnerPrincipal, subject: 'other-owner' }, stopReport),
    );
    await assert.rejects(
      outcomes.stop(runnerPrincipal, { ...stopReport, bootId: randomUUID() }),
    );
    await assert.rejects(
      outcomes.stop(runnerPrincipal, {
        ...stopReport,
        registrationRevision: heartbeat.registrationRevision + 1,
      }),
    );
    await database.runnerAssignment.update({
      where: { id: token.assignmentId },
      data: { claimRegistrationRevision: null },
    });
    await assert.rejects(outcomes.stop(runnerPrincipal, stopReport));
    await database.runnerAssignment.update({
      where: { id: token.assignmentId },
      data: { claimRegistrationRevision: originalRevision },
    });
    const auditBefore = await database.auditEntry.count({
      where: { applicationId, action: 'runner.stop-evidence-quarantined' },
    });
    const failingAuthority = new PrismaRunnerOutcomeAuthority({
      $transaction: (
        work: (tx: Prisma.TransactionClient) => Promise<unknown>,
      ) =>
        database.$transaction((tx) =>
          work(
            new Proxy(tx, {
              get(target, property) {
                if (property === 'outboxEvent') {
                  return {
                    create: async () => {
                      throw new Error('injected outbox unavailable');
                    },
                  };
                }
                const value = Reflect.get(target, property);
                return typeof value === 'function' ? value.bind(target) : value;
              },
            }),
          ),
        ),
    } as unknown as DatabaseService);
    await assert.rejects(
      failingAuthority.stop(runnerPrincipal, stopReport),
      /injected outbox unavailable/,
    );
    assert.equal(
      await database.runnerStopReceipt.count({
        where: { assignmentId: token.assignmentId },
      }),
      0,
    );
    assert.equal(
      await database.auditEntry.count({
        where: { applicationId, action: 'runner.stop-evidence-quarantined' },
      }),
      auditBefore,
    );
    await assert.rejects(
      database.runnerStopReceipt.create({
        data: {
          id: randomUUID(),
          assignmentId: token.assignmentId,
          executionId: token.executionId,
          attemptId: token.attemptId,
          bootId: outcomeBinding.bootId,
          registrationRevision: outcomeBinding.registrationRevision,
          evidenceState: 'TERMINATED',
          terminationMethod: null,
          digest: 'a'.repeat(64),
        },
      }),
    );
    const attemptBeforeStop = await database.attempt.findUniqueOrThrow({
      where: { id: token.attemptId },
    });
    const executionBeforeStop = await database.execution.findUniqueOrThrow({
      where: { id: token.executionId },
    });
    // A current registry revision/status change cannot rewrite the original claim.
    await database.runnerNode.update({
      where: { id: runnerId },
      data: { revision: runner.revision + 1, status: 'DISABLED' },
    });
    const stopped = await outcomes.stop(runnerPrincipal, stopReport);
    await database.runnerNode.update({
      where: { id: runnerId },
      data: { revision: runner.revision, status: runner.status },
    });
    assert.deepEqual(
      await database.attempt.findUniqueOrThrow({
        where: { id: token.attemptId },
      }),
      attemptBeforeStop,
    );
    assert.deepEqual(
      await database.execution.findUniqueOrThrow({
        where: { id: token.executionId },
      }),
      executionBeforeStop,
    );
    const duplicates = await Promise.all(
      Array.from({ length: 5 }, () =>
        outcomes.stop(runnerPrincipal, stopReport),
      ),
    );
    assert.ok(
      duplicates.every((item) => item.id === stopped.id && item.replayed),
    );
    await assert.rejects(
      outcomes.stop(runnerPrincipal, {
        ...stopReport,
        evidence: { state: 'TERMINATED', method: 'OBSERVED' },
      }),
      (error: unknown) =>
        error instanceof ApplicationError &&
        error.code === 'IDEMPOTENCY_CONFLICT',
    );
    assert.equal(
      await database.runnerStopReceipt.count({
        where: { assignmentId: token.assignmentId },
      }),
      1,
    );
    assert.equal(
      await database.outboxEvent.count({
        where: {
          aggregateId: stopped.id,
          topic: 'runner.stop-evidence-received',
        },
      }),
      1,
    );
    assert.equal(
      await database.auditEntry.count({
        where: {
          resourceId: stopped.id,
          action: 'runner.stop-evidence-quarantined',
        },
      }),
      1,
    );
    const stale = (error: unknown) =>
      error instanceof ApplicationError && error.code === 'STALE_ASSIGNMENT';
    await assert.rejects(
      leaseService.activate(runnerPrincipal, { token, ...lease }),
      stale,
    );
    await assert.rejects(reports.report(runnerPrincipal, proposal), stale);
    const evidence = {
      token,
      evidence: {
        executionId: token.executionId,
        attemptId: token.attemptId,
        sourceEventId: 'fixture-call',
        sourceRevision: 1,
        coverage: ['fixture-call'],
        cumulativeUnits: null,
        completeness: 'unknown' as const,
        costBasis: 'unknown' as const,
        reason: 'unknown remote usage',
      },
    };
    const receipt = await reports.evidence(runnerPrincipal, evidence);
    assert.equal(receipt.state, 'QUARANTINED');
    assert.equal(receipt.replayed, false);
    const replay = await reports.evidence(runnerPrincipal, evidence);
    assert.equal(replay.id, receipt.id);
    assert.equal(replay.replayed, true);
    assert.equal(
      await database.ledgerEntry.count({
        where: { executionId: nextExecutionId },
      }),
      0,
    );
    assert.equal(
      await database.usageObservation.count({
        where: { executionId: nextExecutionId },
      }),
      0,
    );
    const recovery = new PrismaRunnerLeaseRecoveryRepository(
      database as unknown as DatabaseService,
    );
    const candidate = (await recovery.scanActive(64)).find(
      (row) => row.assignmentId === token.assignmentId,
    );
    assert.ok(candidate);
    assert.equal(await recovery.fence(candidate, 'LEASE_MISSING'), true);
    assert.equal(
      (await outcomes.stop(runnerPrincipal, stopReport)).stale,
      true,
    );
    assert.equal(
      (
        await outcomes.reconcileResult(runnerPrincipal, {
          ...outcomeBinding,
          proposalDigest,
        })
      ).state,
      cancelFirst ? 'NOT_RECORDED' : 'MATCHED',
    );
    assert.equal(
      (
        await database.attempt.findUniqueOrThrow({
          where: { id: token.attemptId },
        })
      ).authority,
      'FENCED',
    );
    assert.equal(
      (await reports.evidence(runnerPrincipal, evidence)).stale,
      true,
    );
    assert.equal(
      await database.runnerEvidence.count({
        where: { assignmentId: token.assignmentId },
      }),
      1,
    );
    await leaseStore.release({
      ...token,
      ownerSubject: runnerPrincipal.subject,
      nonce: lease.nonce,
    });
  }
});

test('revoked pinned plugin blocks lease activation and new dispatch grants', async () => {
  const executions = await Promise.all(
    Array.from({ length: 2 }, async (_, index) => {
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
        `${prefix}-revoked-plugin-${index}`,
        { envelopeId: nextEnvelopeId, executionId: nextExecutionId },
      );
      return nextExecutionId;
    }),
  );
  const runner = await database.runnerNode.findUniqueOrThrow({
    where: { id: runnerId },
  });
  const claim = {
    runnerId,
    bootId: randomUUID(),
    registrationRevision: runner.revision,
  };
  await liveness.heartbeat(runnerPrincipal, claim);
  const grant = (await dispatch.claim(runnerPrincipal, claim)).grant;
  assert.ok(grant);
  assert.ok(executions.some((id) => id === grant.executionId));
  const remainingExecutionId = executions.find(
    (id) => id !== grant.executionId,
  )!;
  await database.credentialInstance.create({
    data: {
      id: `${prefix}-second-credential`,
      connectionId,
      residency: 'RUNNER_LOCAL',
      runnerRef: ineligibleRunnerId,
    },
  });
  const secondRunner = await database.runnerNode.findUniqueOrThrow({
    where: { id: ineligibleRunnerId },
  });
  const secondClaim = {
    runnerId: ineligibleRunnerId,
    bootId: randomUUID(),
    registrationRevision: secondRunner.revision,
  };
  await liveness.heartbeat(runnerPrincipal, secondClaim);
  const token = {
    assignmentId: grant.assignmentId,
    executionId: grant.executionId,
    attemptId: grant.attemptId,
    runnerId: grant.runnerId,
    generation: grant.generation,
    epoch: grant.epoch,
  };
  const leaseCommand = {
    bootId: claim.bootId,
    registrationRevision: runner.revision,
    nonce: randomBytes(32).toString('base64url'),
    token,
  };
  await leaseService.activate(runnerPrincipal, leaseCommand);
  const payloadAuthorization = new PrismaDispatchPayloadAuthorization(
    database as unknown as DatabaseService,
    leaseService,
  );
  let downloaded: Uint8Array | undefined;
  const delivery = new PluginPackageDeliveryService(
    new PrismaRunnerPluginAuthorization(
      database as unknown as DatabaseService,
      payloadAuthorization,
    ),
    {
      async readVerified(record) {
        const result = await pluginReader.readVerified(record);
        downloaded = result.bytes;
        await database.pluginPackage.update({
          where: {
            applicationId_packageId_version: {
              applicationId,
              packageId: 'agent-fixture',
              version: '1.0.0',
            },
          },
          data: { state: 'REVOKED', revision: { increment: 1 } },
        });
        return result;
      },
    },
  );
  await assert.rejects(
    delivery.read(runnerPrincipal, leaseCommand, grant.envelopeId),
    (error) =>
      error instanceof ApplicationError && error.code === 'STALE_ASSIGNMENT',
  );
  assert.ok(
    downloaded && (downloaded as Uint8Array).every((byte) => byte === 0),
  );
  await assert.rejects(
    leaseService.activate(runnerPrincipal, leaseCommand),
    (error) =>
      error instanceof ApplicationError && error.code === 'STALE_ASSIGNMENT',
  );
  await assert.rejects(
    payloadAuthorization.assertCurrent(
      runnerPrincipal,
      leaseCommand,
      grant.envelopeId,
    ),
    (error) =>
      error instanceof ApplicationError && error.code === 'STALE_ASSIGNMENT',
  );
  await assert.rejects(
    new PrismaRunnerPluginAuthorization(
      database as unknown as DatabaseService,
      payloadAuthorization,
    ).assertCurrent(runnerPrincipal, leaseCommand, grant.envelopeId),
    ApplicationError,
  );
  const authority = new PrismaRunnerAuthority(
    database as unknown as DatabaseService,
  );
  await assert.rejects(
    authority.report(runnerPrincipal, {
      type: 'started',
      token,
      lease: {
        bootId: claim.bootId,
        registrationRevision: runner.revision,
        nonce: leaseCommand.nonce,
      },
    }),
    (error) =>
      error instanceof ApplicationError && error.code === 'STALE_ASSIGNMENT',
  );
  assert.deepEqual(await dispatch.claim(runnerPrincipal, secondClaim), {
    grant: null,
  });
  assert.equal(
    await database.runnerAssignment.count({
      where: { executionId: remainingExecutionId },
    }),
    0,
  );
  assert.equal(
    await leaseStore.release({
      ...token,
      ownerSubject: runnerPrincipal.subject,
      nonce: leaseCommand.nonce,
    }),
    'RELEASED',
  );
});
