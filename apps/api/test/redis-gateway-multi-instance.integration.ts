import { randomUUID } from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/infrastructure/config/environment-config.js';
import { createDatabaseClient } from '../src/infrastructure/database/client.js';
import type { DatabaseService } from '../src/infrastructure/database/database.service.js';
import type { Principal } from '../src/modules/identity/domain/principal.js';
import { M1ControlPlaneService } from '../src/modules/control-plane/application/m1-control-plane.service.js';
import { PrismaM1Repository } from '../src/modules/control-plane/infrastructure/prisma-m1.repository.js';
import {
  GatewayService,
  type GatewayCommand,
} from '../src/modules/gateway/application/gateway.service.js';
import { noopGatewayTelemetry } from '../src/modules/gateway/application/gateway-telemetry.port.js';
import type { ProviderAdapter } from '../src/modules/gateway/application/provider-adapter.port.js';
import { ControlPlaneGatewayAdapter } from '../src/modules/gateway/infrastructure/control-plane-gateway.adapter.js';
import { PrismaGatewayRepository } from '../src/modules/gateway/infrastructure/prisma-gateway.repository.js';
import { RedisGatewayCancelSignal } from '../src/modules/gateway/infrastructure/redis-gateway-cancel.signal.js';
import { RedisGatewayCircuit } from '../src/modules/gateway/infrastructure/redis-gateway.circuit.js';
import { RedisReplayStore } from '../src/modules/gateway/infrastructure/redis-replay.store.js';
import { Sha256RequestFingerprint } from '../src/modules/gateway/infrastructure/sha256-request-fingerprint.js';
import { BoundedStructuredOutputValidator } from '../src/modules/gateway/infrastructure/structured-output.validator.js';

const config = loadConfig();
const redisUrl = config.gateway.replayRedisUrl;
if (!redisUrl) {
  throw new Error(
    'Set M2_REPLAY_REDIS_URL to run the multi-instance Redis gateway test.',
  );
}
const configuredRedisUrl: string = redisUrl;

async function deadline<T>(work: Promise<T>, milliseconds = 5_000) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error('Multi-instance gateway operation timed out.')),
      milliseconds,
    );
    timer.unref();
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function command(profile: string, text: string): GatewayCommand {
  return {
    profile,
    capability: 'chat',
    stream: true,
    messages: [{ role: 'user', text }],
    artifactRefs: [],
    fingerprintInput: { messages: [{ role: 'user', text }] },
  };
}

test('two gateway instances resume and cancel through real Redis without a second provider call', async () => {
  const prefix = `redis-multi-${randomUUID()}`;
  const applicationId = `${prefix}-app`;
  const connectionId = `${prefix}-connection`;
  const credentialId = `${prefix}-credential`;
  const budgetId = `${prefix}-budget`;
  const profileRef = `${prefix}-chat`;
  const bindingId = randomUUID();
  const fixtureDb = createDatabaseClient(config);
  const principal: Principal = {
    subject: applicationId,
    kind: 'application',
    applicationId,
    roles: ['runtime-application'],
    scopes: ['execution:submit', 'execution:read', 'execution:cancel'],
  };
  let resumeCalls = 0;
  let cancelCalls = 0;
  let resumeReady!: () => void;
  let resumeRelease!: () => void;
  let cancelReady!: () => void;
  const resumePublished = new Promise<void>((resolve) => {
    resumeReady = resolve;
  });
  const continueResume = new Promise<void>((resolve) => {
    resumeRelease = resolve;
  });
  const cancelStarted = new Promise<void>((resolve) => {
    cancelReady = resolve;
  });
  const provider: ProviderAdapter = {
    id: 'openrouter',
    async *stream(request, signal) {
      const text = request.messages[0]?.text;
      if (text === 'resume-across-instance') {
        resumeCalls++;
        yield { type: 'started', requestId: 'redis-resume-provider' };
        yield { type: 'delta', text: 'first-' };
        // Resuming after this yield means the first delta reached Redis.
        resumeReady();
        await continueResume;
        yield { type: 'delta', text: 'second' };
        yield { type: 'usage', inputTokens: 2, outputTokens: 2 };
        yield {
          type: 'done',
          requestId: 'redis-resume-provider',
          finishReason: 'stop',
        };
        return;
      }
      cancelCalls++;
      yield { type: 'started', requestId: 'redis-cancel-provider' };
      cancelReady();
      await new Promise<never>((_resolve, reject) => {
        const aborted = () => reject(signal.reason);
        if (signal.aborted) {
          aborted();
          return;
        }
        signal.addEventListener('abort', aborted, { once: true });
      });
    },
  };

  type Runtime = Awaited<ReturnType<typeof createRuntime>>;
  const runtimes: Runtime[] = [];
  async function createRuntime() {
    const db = createDatabaseClient(config);
    const m1 = new PrismaM1Repository(db as unknown as DatabaseService);
    const repository = new PrismaGatewayRepository(
      db as unknown as DatabaseService,
    );
    const replay = await RedisReplayStore.connect(configuredRedisUrl);
    const circuit = await RedisGatewayCircuit.connect(configuredRedisUrl);
    const cancelSignal =
      await RedisGatewayCancelSignal.connect(configuredRedisUrl);
    const gateway = new GatewayService(
      new ControlPlaneGatewayAdapter(new M1ControlPlaneService(m1), m1),
      repository,
      [provider],
      replay,
      new Sha256RequestFingerprint(),
      new BoundedStructuredOutputValidator(),
      randomUUID(),
      circuit,
      noopGatewayTelemetry,
      cancelSignal,
    );
    return { db, repository, replay, circuit, cancelSignal, gateway };
  }

  try {
    await fixtureDb.controlApplication.create({
      data: {
        id: applicationId,
        displayName: 'Redis multi-instance fixture',
        environment: 'local',
        keycloakClientId: `${prefix}-client`,
      },
    });
    await fixtureDb.aiConnection.create({
      data: {
        id: connectionId,
        displayName: 'Redis multi-instance fixture',
        provider: 'openrouter',
        authMode: 'API_KEY',
        environment: 'local',
        sharingMode: 'DEDICATED',
        quotaGroupRef: null,
      },
    });
    await fixtureDb.credentialInstance.create({
      data: {
        id: credentialId,
        connectionId,
        secretRef: 'env:M2_OPENROUTER_API_KEY',
        residency: 'CENTRAL',
        runnerRef: null,
        status: 'ENABLED',
      },
    });
    await fixtureDb.credentialBinding.create({
      data: {
        id: bindingId,
        applicationId,
        connectionId,
        profileRef: null,
        status: 'ENABLED',
      },
    });
    await fixtureDb.budgetAccount.create({
      data: {
        id: budgetId,
        applicationId,
        quotaGroupRef: null,
        unit: 'tokens',
        period: 'fixture',
        limitUnits: 10_000n,
      },
    });
    await fixtureDb.profileRevision.create({
      data: {
        id: randomUUID(),
        applicationId,
        profileRef,
        revision: 1,
        connectionId,
        capability: 'chat',
        providerAdapter: 'openrouter',
        model: 'redis-fixture-model',
        maxOutputTokens: 128,
        timeoutMs: 10_000,
        streaming: true,
        holdUnits: 100n,
        accountIds: [budgetId],
        digest: 'a'.repeat(64),
      },
    });
    await fixtureDb.profileAlias.create({
      data: {
        applicationId,
        profileRef,
        revision: 1,
        enabled: true,
        version: 1,
      },
    });

    const [owner, other] = await Promise.all([
      createRuntime(),
      createRuntime(),
    ]);
    runtimes.push(owner, other);

    const resumeKey = `${prefix}-resume`;
    const resumeCommand = command(profileRef, 'resume-across-instance');
    const running = owner.gateway.execute(principal, resumeCommand, resumeKey);
    await deadline(resumePublished);
    const resumeExecution = await fixtureDb.execution.findFirstOrThrow({
      where: { applicationId, idempotencyKey: resumeKey },
    });
    const watch = await other.gateway.events(
      principal,
      resumeExecution.id,
      `${resumeExecution.id}:0`,
    );
    try {
      assert.equal(watch.page.expired, false);
      assert.deepEqual(
        watch.page.events.map((item) => item.type),
        ['model.delta'],
      );
      resumeRelease();
      const replayed = [...watch.page.events];
      for (;;) {
        const next = await deadline(watch.next());
        if (!next) {
          break;
        }
        replayed.push(next);
        if (next.type === 'execution.completed') {
          break;
        }
      }
      assert.deepEqual(
        replayed.map((item) => item.type),
        ['model.delta', 'model.delta', 'usage.updated', 'execution.completed'],
      );
      assert.deepEqual(
        replayed.map((item) => item.sequence),
        [1, 2, 3, 4],
      );
    } finally {
      watch.close();
    }
    const completed = await deadline(running);
    assert.equal(completed.status, 'COMPLETED');
    assert.deepEqual(completed.result, {
      kind: 'text',
      text: 'first-second',
    });
    const replayedResult = await other.gateway.execute(
      principal,
      resumeCommand,
      resumeKey,
    );
    assert.equal(replayedResult.replayed, true);
    assert.equal(resumeCalls, 1);
    assert.equal(
      await fixtureDb.providerInvocation.count({
        where: { executionId: resumeExecution.id },
      }),
      1,
    );

    const cancelKey = `${prefix}-cancel`;
    const cancelling = owner.gateway.execute(
      principal,
      command(profileRef, 'cancel-across-instance'),
      cancelKey,
    );
    await deadline(cancelStarted);
    const cancelExecution = await fixtureDb.execution.findFirstOrThrow({
      where: { applicationId, idempotencyKey: cancelKey },
    });
    await other.gateway.cancel(
      principal,
      cancelExecution.id,
      'cancel from the other instance',
    );
    await assert.rejects(deadline(cancelling));
    const cancelled = await fixtureDb.execution.findUniqueOrThrow({
      where: { id: cancelExecution.id },
    });
    assert.equal(cancelled.status, 'CANCELLED');
    assert.equal(cancelCalls, 1);
    assert.equal(
      await fixtureDb.providerInvocation.count({
        where: { executionId: cancelExecution.id },
      }),
      1,
    );
  } finally {
    const executions = await fixtureDb.execution.findMany({
      where: { applicationId },
      select: { id: true },
    });
    const executionIds = executions.map((item) => item.id);
    if (runtimes[0]) {
      await Promise.allSettled(
        executionIds.map((executionId) =>
          runtimes[0]!.replay.clear(executionId),
        ),
      );
    }
    for (const runtime of runtimes) {
      await Promise.allSettled([
        runtime.replay.onModuleDestroy(),
        runtime.circuit.onModuleDestroy(),
        runtime.cancelSignal.onModuleDestroy(),
        runtime.db.$disconnect(),
      ]);
    }
    await fixtureDb.ledgerEntry.deleteMany({
      where: { executionId: { in: executionIds } },
    });
    await fixtureDb.usageObservation.deleteMany({
      where: { executionId: { in: executionIds } },
    });
    await fixtureDb.executionResult.deleteMany({
      where: { executionId: { in: executionIds } },
    });
    await fixtureDb.providerInvocation.deleteMany({
      where: { executionId: { in: executionIds } },
    });
    await fixtureDb.reservation.deleteMany({
      where: { executionId: { in: executionIds } },
    });
    await fixtureDb.attempt.deleteMany({
      where: { executionId: { in: executionIds } },
    });
    await fixtureDb.outboxEvent.deleteMany({ where: { applicationId } });
    await fixtureDb.execution.deleteMany({ where: { applicationId } });
    await fixtureDb.admissionRateWindow.deleteMany({
      where: {
        scopeKey: {
          in: [`application:${applicationId}`, `connection:${connectionId}`],
        },
      },
    });
    await fixtureDb.profileAlias.deleteMany({ where: { applicationId } });
    await fixtureDb.profileRevision.deleteMany({ where: { applicationId } });
    await fixtureDb.budgetProjection.deleteMany({
      where: { accountId: budgetId },
    });
    await fixtureDb.budgetAccount.deleteMany({ where: { id: budgetId } });
    await fixtureDb.credentialBinding.deleteMany({ where: { applicationId } });
    await fixtureDb.credentialInstance.deleteMany({
      where: { id: credentialId },
    });
    await fixtureDb.aiConnection.deleteMany({ where: { id: connectionId } });
    await fixtureDb.auditEntry.deleteMany({ where: { applicationId } });
    await fixtureDb.controlApplication.deleteMany({
      where: { id: applicationId },
    });
    await fixtureDb.$disconnect();
  }
});
