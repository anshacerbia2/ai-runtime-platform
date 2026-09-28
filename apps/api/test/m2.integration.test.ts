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
import { InMemoryGatewayCircuit } from '../src/modules/gateway/infrastructure/in-memory-gateway.circuit.js';
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
    randomUUID(),
    new InMemoryGatewayCircuit(),
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

test('a former provider owner cannot commit after attempt authority moves', async () => {
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
      yield { type: 'started', requestId: 'provider-stale-owner' };
      started();
      await providerRelease;
      yield {
        type: 'done',
        requestId: 'provider-stale-owner',
        finishReason: 'stop',
      };
    },
  };
  const key = prefix + '-stale-owner';
  const running = gateway(provider).execute(principal, command('stale'), key);
  await providerStarted;
  const execution = await db.execution.findUniqueOrThrow({
    where: {
      applicationId_idempotencyKey: {
        applicationId: application.id,
        idempotencyKey: key,
      },
    },
    include: { attempts: true },
  });
  const attempt = execution.attempts[0]!;
  assert.ok(attempt.ownerInstanceId);
  assert.equal(
    await repository.cancelOwner(application.id, execution.id),
    attempt.ownerInstanceId,
  );
  assert.equal(await repository.cancelOwner('other-app', execution.id), null);
  await db.attempt.update({
    where: { id: attempt.id },
    data: { ownerInstanceId: randomUUID() },
  });
  release();
  await assert.rejects(running);
  const fenced = await db.execution.findUniqueOrThrow({
    where: { id: execution.id },
    include: { result: true, providerInvocations: true, observations: true },
  });
  assert.equal(fenced.result, null);
  assert.equal(fenced.status, 'RUNNING');
  assert.equal(fenced.providerInvocations[0]?.status, 'RUNNING');
  assert.equal(fenced.observations.length, 0);
});

test('cancel on a second API instance wins over an in-flight provider', async () => {
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const provider: ProviderAdapter = {
    id: 'openrouter',
    async *stream(_request, signal) {
      yield { type: 'started', requestId: 'provider-cross-pod-cancel' };
      started();
      await new Promise<never>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), {
          once: true,
        });
      });
    },
  };
  const key = prefix + '-cross-pod-cancel';
  const owner = gateway(provider);
  const other = gateway(provider);
  const running = owner.execute(principal, command('cancel cross pod'), key);
  await ready;
  const beforeCancel = await db.execution.findUniqueOrThrow({
    where: {
      applicationId_idempotencyKey: {
        applicationId: application.id,
        idempotencyKey: key,
      },
    },
  });
  await other.cancel(principal, beforeCancel.id, 'cancel elsewhere');
  await assert.rejects(running);
  const cancelled = await db.execution.findUniqueOrThrow({
    where: { id: beforeCancel.id },
    include: {
      result: true,
      attempts: true,
      providerInvocations: true,
      reservations: true,
      observations: true,
    },
  });
  assert.equal(cancelled.status, 'CANCELLED');
  assert.equal(cancelled.result, null);
  assert.equal(cancelled.attempts[0]?.status, 'CANCELLED');
  assert.equal(cancelled.providerInvocations[0]?.status, 'UNKNOWN');
  assert.equal(cancelled.reservations[0]?.state, 'PENDING_RECONCILIATION');
  assert.equal(cancelled.observations[0]?.completeness, 'unknown');
});

test('expired provider work is fenced once and retained for reconciliation', async () => {
  let providerCalls = 0;
  let started!: () => void;
  let release!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const providerRelease = new Promise<void>((resolve) => {
    release = resolve;
  });
  const provider: ProviderAdapter = {
    id: 'openrouter',
    async *stream() {
      providerCalls++;
      yield { type: 'started', requestId: 'provider-expired-owner' };
      started();
      await providerRelease;
      yield {
        type: 'done',
        requestId: 'provider-expired-owner',
        finishReason: 'stop',
      };
    },
  };
  const key = prefix + '-expired-provider';
  const running = gateway(provider).execute(principal, command('expired'), key);
  await ready;
  try {
    const execution = await db.execution.findUniqueOrThrow({
      where: {
        applicationId_idempotencyKey: {
          applicationId: application.id,
          idempotencyKey: key,
        },
      },
      include: { providerInvocations: true, reservations: true },
    });
    await repository.recoverExpiredInvocations();
    assert.equal(
      (await db.execution.findUniqueOrThrow({ where: { id: execution.id } }))
        .status,
      'RUNNING',
    );
    await db.providerInvocation.update({
      where: { id: execution.providerInvocations[0]!.id },
      data: { startedAt: new Date(Date.now() - 65_000) },
    });
    let recovered: number;
    try {
      const [first, second] = await Promise.all([
        repository.recoverExpiredInvocations(),
        repository.recoverExpiredInvocations(),
      ]);
      recovered = first + second;
    } finally {
      release();
    }
    assert.ok(recovered >= 1);
    await assert.rejects(running);
    await assert.rejects(
      gateway(provider).execute(principal, command('expired'), key),
    );
    assert.equal(providerCalls, 1);
    const fenced = await db.execution.findUniqueOrThrow({
      where: { id: execution.id },
      include: {
        result: true,
        attempts: true,
        providerInvocations: true,
        reservations: true,
        observations: true,
      },
    });
    assert.equal(fenced.status, 'RECONCILING');
    assert.equal(fenced.statusReason, 'PROVIDER_OWNER_DEADLINE_EXCEEDED');
    assert.equal(fenced.result, null);
    assert.equal(fenced.attempts[0]?.authority, 'FENCED');
    assert.equal(fenced.attempts[0]?.external, 'UNKNOWN');
    assert.equal(fenced.providerInvocations[0]?.status, 'UNKNOWN');
    assert.equal(fenced.reservations[0]?.state, 'PENDING_RECONCILIATION');
    assert.equal(
      fenced.reservations[0]?.heldUnits,
      execution.reservations[0]?.heldUnits,
    );
    assert.equal(fenced.observations.length, 0);
    assert.equal(
      await db.outboxEvent.count({
        where: { aggregateId: execution.id, topic: 'execution.reconciling' },
      }),
      1,
    );
    await repository.recoverExpiredInvocations();
    assert.equal(
      await db.outboxEvent.count({
        where: { aggregateId: execution.id, topic: 'execution.reconciling' },
      }),
      1,
    );
  } finally {
    release();
    await running.catch(() => {});
  }
});

test('expired owner with durable cancel intent closes without releasing unknown spend', async () => {
  const digest = 'e'.repeat(64);
  const admitted = await control.admit(
    principal,
    profileRef,
    digest,
    prefix + '-expired-cancel',
  );
  const claimed = await repository.claim(
    application.id,
    admitted.execution.id,
    digest,
    randomUUID(),
  );
  assert.equal(claimed.state, 'claimed');
  await control.cancel(principal, admitted.execution.id, 'owner vanished');
  await db.providerInvocation.updateMany({
    where: { executionId: admitted.execution.id },
    data: { startedAt: new Date(Date.now() - 65_000) },
  });
  assert.equal(await repository.recoverExpiredInvocations(), 1);
  const execution = await db.execution.findUniqueOrThrow({
    where: { id: admitted.execution.id },
    include: { result: true, attempts: true, reservations: true },
  });
  assert.equal(execution.status, 'CANCELLED');
  assert.equal(execution.result, null);
  assert.equal(execution.attempts[0]?.authority, 'FENCED');
  assert.equal(execution.reservations[0]?.state, 'PENDING_RECONCILIATION');
  assert.ok(execution.reservations[0]?.heldUnits > 0n);
});

test('provider owner stops after the recovery fence is committed', async () => {
  let started!: () => void;
  let release!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const forceRelease = new Promise<void>((resolve) => {
    release = resolve;
  });
  const provider: ProviderAdapter = {
    id: 'openrouter',
    async *stream(_request, signal) {
      yield { type: 'started', requestId: 'provider-fenced-owner' };
      started();
      await Promise.race([
        forceRelease,
        new Promise<never>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), {
            once: true,
          });
        }),
      ]);
    },
  };
  const key = prefix + '-fenced-owner-poll';
  const running = gateway(provider).execute(principal, command('fence'), key);
  await ready;
  try {
    const execution = await db.execution.findUniqueOrThrow({
      where: {
        applicationId_idempotencyKey: {
          applicationId: application.id,
          idempotencyKey: key,
        },
      },
      include: { providerInvocations: true },
    });
    await db.providerInvocation.update({
      where: { id: execution.providerInvocations[0]!.id },
      data: { startedAt: new Date(Date.now() - 65_000) },
    });
    await repository.recoverExpiredInvocations();
    let timeout!: ReturnType<typeof setTimeout>;
    try {
      await assert.rejects(
        Promise.race([
          running,
          new Promise((_resolve, reject) => {
            timeout = setTimeout(
              () => reject(new Error('Owner did not stop.')),
              4_000,
            );
          }),
        ]),
        (error: unknown) =>
          error instanceof Error && !error.message.includes('did not stop'),
      );
    } finally {
      clearTimeout(timeout);
    }
    assert.equal(
      (await db.execution.findUniqueOrThrow({ where: { id: execution.id } }))
        .status,
      'RECONCILING',
    );
  } finally {
    release();
    await running.catch(() => {});
  }
});

test('only expired gateway admissions release an unclaimed hold', async () => {
  const before = await db.budgetAccount.findUniqueOrThrow({
    where: { id: budgetId },
  });
  const digest = 'f'.repeat(64);
  const gatewayKey = prefix + '-unclaimed-gateway';
  const gatewayAdmission = await control.admit(
    principal,
    profileRef,
    digest,
    gatewayKey,
  );
  const m1 = new PrismaM1Repository(db as unknown as DatabaseService);
  const directAdmission = await m1.admit(
    principal,
    { profileRef, inputDigest: digest },
    prefix + '-unclaimed-control',
  );
  await assert.rejects(
    m1.admit(principal, { profileRef, inputDigest: digest }, gatewayKey),
    /different request/i,
  );
  await db.execution.updateMany({
    where: {
      id: {
        in: [gatewayAdmission.execution.id, directAdmission.execution.id],
      },
    },
    data: { createdAt: new Date(Date.now() - 65_000) },
  });
  assert.ok((await repository.recoverExpiredAdmissions()) >= 1);
  const gatewayExecution = await db.execution.findUniqueOrThrow({
    where: { id: gatewayAdmission.execution.id },
    include: { attempts: true, reservations: true, providerInvocations: true },
  });
  const directExecution = await db.execution.findUniqueOrThrow({
    where: { id: directAdmission.execution.id },
    include: { reservations: true },
  });
  const account = await db.budgetAccount.findUniqueOrThrow({
    where: { id: budgetId },
  });
  assert.equal(gatewayExecution.admissionSource, 'GATEWAY');
  assert.equal(gatewayExecution.status, 'FAILED');
  assert.equal(
    gatewayExecution.statusReason,
    'GATEWAY_CLAIM_DEADLINE_EXCEEDED',
  );
  assert.equal(gatewayExecution.attempts[0]?.external, 'NONE');
  assert.equal(gatewayExecution.providerInvocations.length, 0);
  assert.equal(gatewayExecution.reservations[0]?.heldUnits, 0n);
  assert.equal(gatewayExecution.reservations[0]?.postedUnits, 0n);
  assert.equal(gatewayExecution.reservations[0]?.state, 'SETTLED');
  assert.equal(directExecution.admissionSource, 'CONTROL_PLANE');
  assert.equal(directExecution.status, 'ACCEPTED');
  assert.equal(directExecution.reservations[0]?.heldUnits, 100n);
  assert.equal(account.heldUnits, before.heldUnits + 100n);
  await repository.recoverExpiredAdmissions();
  assert.equal(
    await db.outboxEvent.count({
      where: {
        aggregateId: gatewayExecution.id,
        topic: 'execution.failed',
      },
    }),
    1,
  );
});

test('claim and orphan release serialize before any provider invocation', async () => {
  const digest = '1'.repeat(64);
  const admitted = await control.admit(
    principal,
    profileRef,
    digest,
    prefix + '-claim-recovery-race',
  );
  await db.execution.update({
    where: { id: admitted.execution.id },
    data: { createdAt: new Date(Date.now() - 65_000) },
  });
  const [, claimed] = await Promise.all([
    repository.recoverExpiredAdmissions(),
    repository.claim(
      application.id,
      admitted.execution.id,
      digest,
      randomUUID(),
    ),
  ]);
  const execution = await db.execution.findUniqueOrThrow({
    where: { id: admitted.execution.id },
    include: { reservations: true, providerInvocations: true },
  });
  if (claimed.state === 'claimed') {
    assert.equal(execution.status, 'RUNNING');
    assert.equal(execution.providerInvocations.length, 1);
    assert.equal(execution.reservations[0]?.state, 'RESERVED');
    assert.ok(execution.reservations[0]?.heldUnits > 0n);
  } else {
    assert.equal(execution.status, 'FAILED');
    assert.equal(execution.providerInvocations.length, 0);
    assert.equal(execution.reservations[0]?.heldUnits, 0n);
    assert.equal(execution.reservations[0]?.state, 'SETTLED');
  }
});
