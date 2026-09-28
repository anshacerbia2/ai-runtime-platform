import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GatewayExecution,
  GatewayStreamEvent,
  type GatewayStreamEvent as GatewayStreamEventValue,
} from '@ai-runtime/contracts/http';
import { createApplication } from '../dist/bootstrap.js';
import {
  loadConfig,
  type RuntimeConfig,
} from '../src/infrastructure/config/environment-config.js';
import { createDatabaseClient } from '../src/infrastructure/database/client.js';
import { seedDatabase } from '../src/infrastructure/database/seed.js';
import { RedisReplayStore } from '../src/modules/gateway/infrastructure/redis-replay.store.js';

const baseConfig = loadConfig();
const redisUrl = baseConfig.gateway.replayRedisUrl;
if (!redisUrl) {
  throw new Error(
    'Set M2_REPLAY_REDIS_URL to run the HTTP multi-instance Redis test.',
  );
}
const configuredRedisUrl: string = redisUrl;

async function deadline<T>(work: Promise<T>, milliseconds = 10_000) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error('HTTP multi-instance operation timed out.')),
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

interface SseReader {
  reader: ReadableStreamDefaultReader<Uint8Array>;
  decoder: TextDecoder;
  buffer: string;
}

function sseReader(response: Response): SseReader {
  assert.match(
    response.headers.get('content-type') ?? '',
    /^text\/event-stream/i,
  );
  assert.ok(response.body);
  return {
    reader: response.body.getReader(),
    decoder: new TextDecoder('utf-8', { fatal: true }),
    buffer: '',
  };
}

async function nextEvent(stream: SseReader): Promise<GatewayStreamEventValue> {
  for (;;) {
    const boundary = stream.buffer.indexOf('\n\n');
    if (boundary >= 0) {
      const frame = stream.buffer.slice(0, boundary);
      stream.buffer = stream.buffer.slice(boundary + 2);
      const data = frame
        .split('\n')
        .filter((line) => line.startsWith('data: '))
        .map((line) => line.slice(6))
        .join('\n');
      if (data) {
        return GatewayStreamEvent.parse(JSON.parse(data));
      }
      continue;
    }
    const chunk = await stream.reader.read();
    if (chunk.done) {
      stream.buffer += stream.decoder.decode();
      throw new Error('SSE response ended before the next event.');
    }
    stream.buffer += stream.decoder.decode(chunk.value, { stream: true });
  }
}

test('HTTP client detaches from API A and resumes on API B without a second provider call', async () => {
  const prefix = `redis-http-${randomUUID()}`;
  const application = {
    id: `${prefix}-app`,
    name: 'Redis HTTP multi-instance fixture',
    token: `${randomUUID()}${randomUUID()}`,
  };
  const connectionId = `${prefix}-connection`;
  const credentialId = `${prefix}-credential`;
  const budgetId = `${prefix}-budget`;
  const profileRef = `${prefix}-chat`;
  const bindingId = randomUUID();
  const idempotencyKey = `${prefix}-request`;
  const db = createDatabaseClient(baseConfig);
  const applications: Array<Awaited<ReturnType<typeof createApplication>>> = [];
  let replay: RedisReplayStore | undefined;
  let executionId: string | undefined;
  let providerCalls = 0;
  let providerListening = false;
  let providerReleased = false;
  let resolveProvider!: () => void;
  const providerRelease = new Promise<void>((resolve) => {
    resolveProvider = resolve;
  });
  const releaseProvider = () => {
    if (!providerReleased) {
      providerReleased = true;
      resolveProvider();
    }
  };
  const provider = createServer(async (request, response) => {
    if (request.method !== 'POST') {
      response.writeHead(404).end();
      return;
    }
    providerCalls++;
    request.resume();
    response.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
    });
    response.write(
      `data: ${JSON.stringify({
        id: 'redis-http-provider',
        choices: [{ delta: { content: 'first-' } }],
      })}\n\n`,
    );
    await providerRelease;
    if (response.destroyed) {
      return;
    }
    response.write(
      `data: ${JSON.stringify({
        id: 'redis-http-provider',
        choices: [{ delta: { content: 'second' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 2, completion_tokens: 2 },
      })}\n\n`,
    );
    response.end('data: [DONE]\n\n');
  });

  try {
    await new Promise<void>((resolve, reject) => {
      provider.once('error', reject);
      provider.listen(0, '127.0.0.1', () => {
        provider.off('error', reject);
        providerListening = true;
        resolve();
      });
    });
    const address = provider.address();
    assert.ok(address && typeof address !== 'string');
    const config = {
      ...baseConfig,
      applications: [application],
      gateway: {
        ...baseConfig.gateway,
        openrouterApiKey: 'redis-http-fixture-key',
        openrouterEndpoint: `http://127.0.0.1:${address.port}/chat`,
        replayRedisUrl: configuredRedisUrl,
      },
    } satisfies RuntimeConfig;

    await seedDatabase(db, config);
    await db.aiConnection.create({
      data: {
        id: connectionId,
        displayName: 'Redis HTTP multi-instance fixture',
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
    await db.budgetAccount.create({
      data: {
        id: budgetId,
        applicationId: application.id,
        quotaGroupRef: null,
        unit: 'tokens',
        period: 'fixture',
        limitUnits: 10_000n,
      },
    });
    await db.profileRevision.create({
      data: {
        id: randomUUID(),
        applicationId: application.id,
        profileRef,
        revision: 1,
        connectionId,
        capability: 'chat',
        providerAdapter: 'openrouter',
        model: 'redis-http-fixture-model',
        maxOutputTokens: 128,
        timeoutMs: 10_000,
        streaming: true,
        holdUnits: 100n,
        accountIds: [budgetId],
        digest: 'c'.repeat(64),
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

    const [owner, other] = await Promise.all([
      createApplication(config),
      createApplication(config),
    ]);
    applications.push(owner, other);
    await Promise.all([
      owner.listen(0, '127.0.0.1'),
      other.listen(0, '127.0.0.1'),
    ]);
    replay = await RedisReplayStore.connect(configuredRedisUrl);
    const ownerUrl = await owner.getUrl();
    const otherUrl = await other.getUrl();
    const body = {
      profile: profileRef,
      stream: true,
      input: {
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: 'resume through another API' }],
          },
        ],
      },
    };
    const headers = {
      authorization: `Bearer ${application.token}`,
      'content-type': 'application/json',
      'idempotency-key': idempotencyKey,
    };

    const firstResponse = await deadline(
      fetch(`${ownerUrl}/v1/chat`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      }),
    );
    assert.equal(firstResponse.status, 200);
    const firstStream = sseReader(firstResponse);
    const firstEvents: GatewayStreamEventValue[] = [];
    while (!firstEvents.some((event) => event.type === 'model.delta')) {
      firstEvents.push(await deadline(nextEvent(firstStream)));
    }
    assert.deepEqual(
      firstEvents.map((event) => event.type),
      ['execution.started', 'model.delta'],
    );
    const firstDelta = firstEvents.at(-1)!;
    executionId = firstDelta.execution_id;
    await deadline(firstStream.reader.cancel());

    const resumedResponse = await deadline(
      fetch(`${otherUrl}/v1/executions/${executionId}/events`, {
        headers: {
          authorization: `Bearer ${application.token}`,
          'last-event-id': firstDelta.id,
        },
      }),
    );
    assert.equal(resumedResponse.status, 200);
    const resumedStream = sseReader(resumedResponse);
    releaseProvider();
    const resumedEvents: GatewayStreamEventValue[] = [];
    while (
      !resumedEvents.some((event) => event.type === 'execution.completed')
    ) {
      resumedEvents.push(await deadline(nextEvent(resumedStream)));
    }
    assert.deepEqual(
      resumedEvents.map((event) => event.type),
      ['model.delta', 'usage.updated', 'execution.completed'],
    );
    assert.deepEqual(
      resumedEvents.map((event) => event.sequence),
      [2, 3, 4],
    );
    assert.ok(
      resumedEvents.every((event) => event.execution_id === executionId),
    );

    const replayResponse = await deadline(
      fetch(`${otherUrl}/v1/chat`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      }),
    );
    assert.equal(
      replayResponse.status,
      200,
      await replayResponse.clone().text(),
    );
    assert.match(
      replayResponse.headers.get('content-type') ?? '',
      /^application\/json/i,
    );
    const snapshot = GatewayExecution.parse(await replayResponse.json());
    assert.equal(snapshot.executionId, executionId);
    assert.equal(snapshot.status, 'COMPLETED');
    assert.equal(snapshot.replayed, true);
    assert.deepEqual(snapshot.result, {
      kind: 'text',
      text: 'first-second',
    });
    assert.equal(providerCalls, 1);
    assert.equal(
      await db.providerInvocation.count({ where: { executionId } }),
      1,
    );
  } finally {
    releaseProvider();
    if (executionId && replay) {
      await replay.clear(executionId).catch(() => undefined);
    }
    await replay?.onModuleDestroy().catch(() => undefined);
    await Promise.allSettled(
      applications.map((applicationInstance) => applicationInstance.close()),
    );
    if (providerListening) {
      provider.closeAllConnections();
      await new Promise<void>((resolve) => provider.close(() => resolve()));
    }
    const executions = await db.execution.findMany({
      where: { applicationId: application.id },
      select: { id: true },
    });
    const executionIds = executions.map((item) => item.id);
    await db.ledgerEntry.deleteMany({
      where: { executionId: { in: executionIds } },
    });
    await db.usageObservation.deleteMany({
      where: { executionId: { in: executionIds } },
    });
    await db.executionResult.deleteMany({
      where: { executionId: { in: executionIds } },
    });
    await db.providerInvocation.deleteMany({
      where: { executionId: { in: executionIds } },
    });
    await db.reservation.deleteMany({
      where: { executionId: { in: executionIds } },
    });
    await db.attempt.deleteMany({
      where: { executionId: { in: executionIds } },
    });
    await db.outboxEvent.deleteMany({
      where: { applicationId: application.id },
    });
    await db.execution.deleteMany({ where: { applicationId: application.id } });
    await db.admissionRateWindow.deleteMany({
      where: {
        scopeKey: {
          in: [`application:${application.id}`, `connection:${connectionId}`],
        },
      },
    });
    await db.profileAlias.deleteMany({
      where: { applicationId: application.id },
    });
    await db.profileRevision.deleteMany({
      where: { applicationId: application.id },
    });
    await db.budgetProjection.deleteMany({ where: { accountId: budgetId } });
    await db.budgetAccount.deleteMany({ where: { id: budgetId } });
    await db.credentialBinding.deleteMany({
      where: { applicationId: application.id },
    });
    await db.credentialInstance.deleteMany({ where: { id: credentialId } });
    await db.aiConnection.deleteMany({ where: { id: connectionId } });
    await db.auditEntry.deleteMany({
      where: { applicationId: application.id },
    });
    await db.profile.deleteMany({ where: { applicationId: application.id } });
    await db.application.deleteMany({ where: { id: application.id } });
    await db.controlApplication.deleteMany({ where: { id: application.id } });
    await db.$disconnect();
  }
});
