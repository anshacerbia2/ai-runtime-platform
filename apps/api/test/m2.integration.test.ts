import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../src/infrastructure/config/environment-config.js';
import { createDatabaseClient } from '../src/infrastructure/database/client.js';
import { seedDatabase } from '../src/infrastructure/database/seed.js';
import type { DatabaseService } from '../src/infrastructure/database/database.service.js';
import type { Principal } from '../src/modules/identity/domain/principal.js';
import { M1ControlPlaneService } from '../src/modules/control-plane/application/m1-control-plane.service.js';
import { PrismaM1Repository } from '../src/modules/control-plane/infrastructure/prisma-m1.repository.js';
import { GatewayService } from '../src/modules/gateway/application/gateway.service.js';
import {
  ProviderError,
  type ProviderAdapter,
} from '../src/modules/gateway/application/provider-adapter.port.js';
import { ControlPlaneGatewayAdapter } from '../src/modules/gateway/infrastructure/control-plane-gateway.adapter.js';
import { PrismaGatewayRepository } from '../src/modules/gateway/infrastructure/prisma-gateway.repository.js';
import { InMemoryReplayStore } from '../src/modules/gateway/infrastructure/in-memory-replay.store.js';
import { Sha256RequestFingerprint } from '../src/modules/gateway/infrastructure/sha256-request-fingerprint.js';
import { BoundedStructuredOutputValidator } from '../src/modules/gateway/infrastructure/structured-output.validator.js';

const prefix = 'm2-' + randomUUID();
const application = {
  id: prefix + '-app',
  name: 'M2 gateway fixture',
  token: randomUUID() + randomUUID(),
};
const config = { ...loadConfig(), applications: [application] };
const db = createDatabaseClient(config);
const connectionId = prefix + '-connection';
const credentialId = prefix + '-credential';
const fallbackConnectionId = prefix + '-fallback-connection';
const fallbackCredentialId = prefix + '-fallback-credential';
const fallbackBindingId = randomUUID();
const budgetId = prefix + '-budget';
const profileRef = prefix + '-chat';
const profileRevisionId = randomUUID();
const structuredProfileRef = prefix + '-structured';
const structuredProfileRevisionId = randomUUID();
const bindingId = randomUUID();

const principal: Principal = {
  subject: application.id,
  kind: 'application',
  applicationId: application.id,
  roles: ['runtime-application'],
  scopes: ['execution:submit', 'execution:read', 'execution:cancel'],
};

let repository: PrismaGatewayRepository;
let control: ControlPlaneGatewayAdapter;

function command(text: string) {
  return {
    profile: profileRef,
    capability: 'chat' as const,
    stream: false,
    messages: [{ role: 'user' as const, text }],
    artifactRefs: [],
    fingerprintInput: { messages: [{ role: 'user', text }] },
  };
}

function structuredCommand() {
  return {
    profile: structuredProfileRef,
    capability: 'structured_generate' as const,
    stream: false,
    messages: [{ role: 'user' as const, text: 'return an object' }],
    artifactRefs: [],
    responseSchema: {
      type: 'object',
      properties: { answer: { type: 'string' } },
      required: ['answer'],
      additionalProperties: false,
    },
    fingerprintInput: { prompt: 'return an object' },
  };
}

function gateway(...providers: ProviderAdapter[]) {
  return new GatewayService(
    control,
    repository,
    providers,
    new InMemoryReplayStore(),
    new Sha256RequestFingerprint(),
    new BoundedStructuredOutputValidator(),
  );
}

before(async () => {
  await seedDatabase(db, config);
  await db.aiConnection.create({
    data: {
      id: connectionId,
      displayName: 'M2 OpenRouter fixture',
      provider: 'openrouter',
      authMode: 'API_KEY',
      environment: 'local',
      sharingMode: 'DEDICATED',
      quotaGroupRef: null,
    },
  });
  await db.credentialInstance.create({
    data: {
      id: credentialId,
      connectionId,
      secretRef: 'env:M2_OPENROUTER_API_KEY',
      residency: 'CENTRAL',
      runnerRef: null,
      status: 'ENABLED',
    },
  });
  await db.credentialBinding.create({
    data: {
      id: bindingId,
      applicationId: application.id,
      connectionId,
      profileRef: null,
      status: 'ENABLED',
    },
  });
  await db.aiConnection.create({
    data: {
      id: fallbackConnectionId,
      displayName: 'M2 Anthropic fallback fixture',
      provider: 'direct-anthropic',
      authMode: 'API_KEY',
      environment: 'local',
      sharingMode: 'DEDICATED',
      quotaGroupRef: null,
    },
  });
  await db.credentialInstance.create({
    data: {
      id: fallbackCredentialId,
      connectionId: fallbackConnectionId,
      secretRef: 'env:M2_ANTHROPIC_API_KEY',
      residency: 'CENTRAL',
      runnerRef: null,
      status: 'ENABLED',
    },
  });
  await db.credentialBinding.create({
    data: {
      id: fallbackBindingId,
      applicationId: application.id,
      connectionId: fallbackConnectionId,
      profileRef: null,
      status: 'ENABLED',
    },
  });
  await db.budgetAccount.create({
    data: {
      id: budgetId,
      applicationId: application.id,
      quotaGroupRef: null,
      unit: 'tokens',
      period: 'fixture',
      limitUnits: 10000n,
    },
  });
  await db.profileRevision.create({
    data: {
      id: profileRevisionId,
      applicationId: application.id,
      profileRef,
      revision: 1,
      connectionId,
      capability: 'chat',
      providerAdapter: 'openrouter',
      model: 'fixture-model',
      fallbackConnectionId,
      fallbackProviderAdapter: 'direct-anthropic',
      fallbackModel: 'fixture-anthropic-model',
      maxOutputTokens: 128,
      timeoutMs: 10000,
      streaming: true,
      holdUnits: 100n,
      accountIds: [budgetId],
      digest: 'a'.repeat(64),
    },
  });
  await db.profileAlias.create({
    data: {
      applicationId: application.id,
      profileRef,
      revision: 1,
      enabled: true,
      version: 1,
    },
  });
  await db.profileRevision.create({
    data: {
      id: structuredProfileRevisionId,
      applicationId: application.id,
      profileRef: structuredProfileRef,
      revision: 1,
      connectionId,
      capability: 'structured_generate',
      providerAdapter: 'openrouter',
      model: 'fixture-model',
      maxOutputTokens: 128,
      timeoutMs: 10000,
      streaming: false,
      holdUnits: 100n,
      accountIds: [budgetId],
      digest: 'b'.repeat(64),
    },
  });
  await db.profileAlias.create({
    data: {
      applicationId: application.id,
      profileRef: structuredProfileRef,
      revision: 1,
      enabled: true,
      version: 1,
    },
  });
  const m1 = new PrismaM1Repository(db as unknown as DatabaseService);
  repository = new PrismaGatewayRepository(db as unknown as DatabaseService);
  control = new ControlPlaneGatewayAdapter(new M1ControlPlaneService(m1), m1);
});

after(async () => {
  const executions = await db.execution.findMany({
    where: { applicationId: application.id },
    select: { id: true },
  });
  const ids = executions.map((item) => item.id);
  await db.ledgerEntry.deleteMany({ where: { executionId: { in: ids } } });
  await db.usageObservation.deleteMany({ where: { executionId: { in: ids } } });
  await db.executionResult.deleteMany({ where: { executionId: { in: ids } } });
  await db.providerInvocation.deleteMany({
    where: { executionId: { in: ids } },
  });
  await db.reservation.deleteMany({ where: { executionId: { in: ids } } });
  await db.attempt.deleteMany({ where: { executionId: { in: ids } } });
  await db.outboxEvent.deleteMany({ where: { applicationId: application.id } });
  await db.execution.deleteMany({ where: { id: { in: ids } } });
  await db.profileAlias.deleteMany({
    where: { applicationId: application.id },
  });
  await db.profileRevision.deleteMany({
    where: { applicationId: application.id },
  });
  await db.budgetProjection.deleteMany({ where: { accountId: budgetId } });
  await db.budgetAccount.deleteMany({ where: { id: budgetId } });
  await db.credentialBinding.deleteMany({
    where: { id: { in: [bindingId, fallbackBindingId] } },
  });
  await db.credentialInstance.deleteMany({
    where: { id: { in: [credentialId, fallbackCredentialId] } },
  });
  await db.aiConnection.deleteMany({
    where: { id: { in: [connectionId, fallbackConnectionId] } },
  });
  await db.auditEntry.deleteMany({ where: { applicationId: application.id } });
  await db.managementReceipt.deleteMany({
    where: { requestKey: { startsWith: prefix } },
  });
  await db.admissionRateWindow.deleteMany({
    where: { scopeKey: { contains: prefix } },
  });
  await db.controlApplication.deleteMany({ where: { id: application.id } });
  await db.contractCheck.deleteMany({
    where: { applicationId: application.id },
  });
  await db.profile.deleteMany({ where: { applicationId: application.id } });
  await db.application.deleteMany({ where: { id: application.id } });
  await db.$disconnect();
});

test('M2 gateway commits result, provider evidence, settlement and exact replay', async () => {
  let calls = 0;
  const provider: ProviderAdapter = {
    id: 'openrouter',
    async *stream(request) {
      calls++;
      assert.equal(request.credentialRef, 'env:M2_OPENROUTER_API_KEY');
      assert.equal(request.model, 'fixture-model');
      yield { type: 'started', requestId: 'provider-success' };
      yield { type: 'delta', text: 'durable answer' };
      yield { type: 'usage', inputTokens: 10, outputTokens: 5 };
      yield {
        type: 'done',
        requestId: 'provider-success',
        finishReason: 'stop',
      };
    },
  };
  const runtime = gateway(provider);
  const key = prefix + '-success';

  const first = await runtime.execute(principal, command('hello'), key);
  assert.equal(first.status, 'COMPLETED');
  assert.deepEqual(first.result, { kind: 'text', text: 'durable answer' });
  assert.equal(first.usage.totalTokens, 15);

  const stored = await db.execution.findUniqueOrThrow({
    where: { id: first.executionId },
    include: {
      result: true,
      providerInvocations: true,
      reservations: true,
      observations: true,
      ledger: true,
    },
  });
  assert.equal(stored.status, 'COMPLETED');
  assert.equal(stored.result?.providerRequestId, 'provider-success');
  assert.equal(stored.providerInvocations[0]?.status, 'SUCCEEDED');
  assert.equal(stored.observations.length, 1);
  assert.equal(stored.ledger.length, 1);
  assert.equal(stored.ledger[0]?.deltaUnits, 15n);
  assert.equal(stored.reservations[0]?.state, 'SETTLED');
  assert.equal(stored.reservations[0]?.heldUnits, 0n);
  assert.equal(stored.reservations[0]?.postedUnits, 15n);

  const account = await db.budgetAccount.findUniqueOrThrow({
    where: { id: budgetId },
  });
  assert.equal(account.heldUnits, 0n);
  assert.equal(account.postedUnits, 15n);

  const replay = await runtime.execute(principal, command('hello'), key);
  assert.equal(replay.replayed, true);
  assert.equal(replay.executionId, first.executionId);
  assert.equal(calls, 1);

  await assert.rejects(
    runtime.execute(principal, command('changed input'), key),
    /different request/i,
  );
  assert.equal(calls, 1);
});

test('G17 not-sent primary failure uses one policy-approved durable fallback attempt', async () => {
  let primaryCalls = 0;
  let fallbackCalls = 0;
  const primary: ProviderAdapter = {
    id: 'openrouter',
    async *stream() {
      primaryCalls++;
      yield await Promise.reject(
        new ProviderError(
          'openrouter',
          'PRIMARY_CREDENTIAL_TEMPORARILY_UNAVAILABLE',
          'not-sent',
        ),
      );
    },
  };
  const fallback: ProviderAdapter = {
    id: 'direct-anthropic',
    async *stream(request) {
      fallbackCalls++;
      assert.equal(request.credentialRef, 'env:M2_ANTHROPIC_API_KEY');
      assert.equal(request.model, 'fixture-anthropic-model');
      yield { type: 'started', requestId: 'fallback-request' };
      yield { type: 'delta', text: 'fallback answer' };
      yield { type: 'usage', inputTokens: 4, outputTokens: 2 };
      yield {
        type: 'done',
        requestId: 'fallback-request',
        finishReason: 'end_turn',
      };
    },
  };
  const runtime = gateway(primary, fallback);
  const key = prefix + '-safe-fallback';

  const result = await runtime.execute(
    principal,
    command('safe fallback'),
    key,
  );
  assert.equal(result.status, 'COMPLETED');
  assert.equal(result.provider, 'direct-anthropic');
  assert.equal(result.model, 'fixture-anthropic-model');
  assert.deepEqual(result.result, {
    kind: 'text',
    text: 'fallback answer',
  });
  assert.equal(primaryCalls, 1);
  assert.equal(fallbackCalls, 1);

  const stored = await db.execution.findUniqueOrThrow({
    where: { id: result.executionId },
    include: {
      attempts: { orderBy: { number: 'asc' } },
      providerInvocations: { orderBy: { startedAt: 'asc' } },
      reservations: true,
      observations: true,
      ledger: true,
    },
  });
  assert.equal(stored.attempts.length, 2);
  assert.equal(stored.attempts[0]?.status, 'FAILED');
  assert.equal(stored.attempts[0]?.external, 'NONE');
  assert.equal(stored.attempts[1]?.status, 'SUCCEEDED');
  assert.equal(stored.providerInvocations.length, 2);
  assert.equal(stored.providerInvocations[0]?.provider, 'openrouter');
  assert.equal(stored.providerInvocations[0]?.status, 'FAILED');
  assert.equal(stored.providerInvocations[1]?.provider, 'direct-anthropic');
  assert.equal(stored.providerInvocations[1]?.status, 'SUCCEEDED');
  assert.equal(stored.reservations.length, 1);
  assert.equal(stored.observations.length, 1);
  assert.equal(stored.ledger.length, 1);
  assert.equal(stored.ledger[0]?.deltaUnits, 6n);
  assert.equal(stored.reservations[0]?.postedUnits, 6n);
  assert.equal(stored.reservations[0]?.heldUnits, 0n);

  const replay = await runtime.execute(
    principal,
    command('safe fallback'),
    key,
  );
  assert.equal(replay.replayed, true);
  assert.equal(replay.provider, 'direct-anthropic');
  assert.equal(primaryCalls, 1);
  assert.equal(fallbackCalls, 1);
});

test('G16 invalid structured output fails platform result without rewriting provider success', async () => {
  let calls = 0;
  const provider: ProviderAdapter = {
    id: 'openrouter',
    async *stream() {
      calls++;
      yield { type: 'started', requestId: 'provider-structured-invalid' };
      yield { type: 'delta', text: '{"wrong":true}' };
      yield { type: 'usage', inputTokens: 3, outputTokens: 2 };
      yield {
        type: 'done',
        requestId: 'provider-structured-invalid',
        finishReason: 'stop',
      };
    },
  };
  const runtime = gateway(provider);
  const key = prefix + '-structured-invalid';

  await assert.rejects(
    runtime.execute(principal, structuredCommand(), key),
    (error: unknown) =>
      error instanceof Error &&
      error.message.includes('does not satisfy the requested response schema'),
  );

  const execution = await db.execution.findFirstOrThrow({
    where: { applicationId: application.id, idempotencyKey: key },
    include: {
      result: true,
      providerInvocations: true,
      attempts: true,
      reservations: true,
      observations: true,
      ledger: true,
    },
  });
  assert.equal(execution.status, 'FAILED');
  assert.equal(execution.statusReason, 'STRUCTURED_OUTPUT_INVALID');
  assert.equal(execution.result, null);
  assert.equal(execution.providerInvocations[0]?.status, 'SUCCEEDED');
  assert.equal(execution.providerInvocations[0]?.errorCode, null);
  assert.equal(execution.attempts[0]?.external, 'COMPLETE');
  assert.equal(execution.observations[0]?.completeness, 'complete');
  assert.equal(execution.ledger[0]?.deltaUnits, 5n);
  assert.equal(execution.reservations[0]?.state, 'SETTLED');
  assert.equal(execution.reservations[0]?.heldUnits, 0n);

  await assert.rejects(
    runtime.execute(principal, structuredCommand(), key),
    /previously ended without a successful result/i,
  );
  assert.equal(calls, 1);
});

test('ambiguous provider failure keeps the hold and never splices a fallback', async () => {
  let fallbackCalls = 0;
  const provider: ProviderAdapter = {
    id: 'openrouter',
    async *stream() {
      yield { type: 'started', requestId: 'provider-ambiguous' };
      throw new ProviderError('openrouter', 'CONNECTION_LOST', 'unknown');
    },
  };
  const fallback: ProviderAdapter = {
    id: 'direct-anthropic',
    async *stream() {
      fallbackCalls++;
      yield { type: 'done', requestId: 'should-not-run', finishReason: 'stop' };
    },
  };
  const runtime = gateway(provider, fallback);
  const key = prefix + '-ambiguous';

  await assert.rejects(
    runtime.execute(principal, command('ambiguous'), key),
    /not confirmed/i,
  );

  const execution = await db.execution.findFirstOrThrow({
    where: { applicationId: application.id, idempotencyKey: key },
    include: {
      providerInvocations: true,
      reservations: true,
      observations: true,
      ledger: true,
    },
  });
  assert.equal(execution.status, 'RECONCILING');
  assert.equal(execution.providerInvocations[0]?.status, 'UNKNOWN');
  assert.equal(execution.reservations[0]?.state, 'PENDING_RECONCILIATION');
  assert.equal(execution.reservations[0]?.heldUnits, 100n);
  assert.equal(execution.reservations[0]?.postedUnits, 0n);
  assert.equal(execution.observations.length, 1);
  assert.equal(execution.observations[0]?.completeness, 'unknown');
  assert.equal(execution.ledger.length, 0);
  assert.equal(fallbackCalls, 0);
});
test('concurrent same-key replay observes RUNNING without a second provider call', async () => {
  let providerCalls = 0;
  let started!: () => void;
  let release!: () => void;
  const providerStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  const providerRelease = new Promise<void>((resolve) => {
    release = resolve;
  });
  const provider: ProviderAdapter = {
    id: 'openrouter',
    async *stream() {
      providerCalls++;
      yield { type: 'started', requestId: 'provider-concurrent' };
      started();
      await providerRelease;
      yield { type: 'delta', text: 'done' };
      yield { type: 'usage', inputTokens: 1, outputTokens: 1 };
      yield {
        type: 'done',
        requestId: 'provider-concurrent',
        finishReason: 'stop',
      };
    },
  };
  const runtime = gateway(provider);
  const key = prefix + '-concurrent';

  const first = runtime.execute(principal, command('same'), key);
  await providerStarted;
  const replay = await runtime.execute(principal, command('same'), key);
  assert.equal(replay.status, 'RUNNING');
  assert.equal(replay.replayed, true);
  assert.equal(providerCalls, 1);

  release();
  const completed = await first;
  assert.equal(completed.status, 'COMPLETED');
  assert.equal(providerCalls, 1);
});
