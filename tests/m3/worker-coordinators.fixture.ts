import assert from 'node:assert/strict';
import { fork, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createServer, request as proxyRequest, type Server } from 'node:http';
import { resolve } from 'node:path';
import type { TestContext } from 'node:test';
import { createClient } from 'redis';
import {
  apiContract,
  type RunnerDispatchGrant,
} from '@ai-runtime/contracts/http';
import {
  loadConfig,
  type RuntimeConfig,
} from '../../apps/api/src/infrastructure/config/environment-config.js';
import { createDatabaseClient } from '../../apps/api/src/infrastructure/database/client.js';
import type { DatabaseService } from '../../apps/api/src/infrastructure/database/database.service.js';
import { PrismaM1Repository } from '../../apps/api/src/modules/control-plane/infrastructure/prisma-m1.repository.js';
import { M1ControlPlaneService } from '../../apps/api/src/modules/control-plane/application/m1-control-plane.service.js';
import { PrismaDispatchEnvelopeRepository } from '../../apps/api/src/modules/dispatch-envelope/infrastructure/prisma-dispatch-envelope.repository.js';
import { runnerPresenceKey } from '../../apps/api/src/modules/control-plane/infrastructure/runner-presence-proof.js';
import {
  RunnerWorker,
  type RunnerStepContext,
  type RunnerWorkerOptions,
} from '../../apps/runner/src/runner-worker.js';
import type { RunnerEvidenceCollector } from '../../apps/runner/src/runner-evidence-collector.js';
import type { RunnerHttpOptions } from '../../apps/runner/src/runner-http-transport.js';

export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

export async function until<T>(
  read: () => Promise<T>,
  accept: (value: T) => boolean,
  label: string,
  timeoutMs = 10_000,
): Promise<T> {
  const end = performance.now() + timeoutMs;
  while (performance.now() < end) {
    const value = await read();
    if (accept(value)) {
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

async function deadline<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Coordinator operation timed out.')),
          ms,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

interface Instance {
  child: ChildProcess;
  url: string;
}
async function startInstance(config: RuntimeConfig): Promise<Instance> {
  // Reuse the full AppModule child fixture; tsx does not compile Nest metadata.
  const child = fork(
    resolve('apps/api/test/support/gateway-http-instance.ts'),
    [],
    {
      execArgv: ['--import', 'tsx'],
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    },
  );
  const ready = new Promise<string>((resolveReady, reject) => {
    child.once('error', reject);
    child.once('exit', () =>
      reject(new Error('Coordinator exited before ready.')),
    );
    child.on('message', (raw: unknown) => {
      const message = raw as { type?: string; url?: string };
      if (message.type === 'ready' && message.url) {
        resolveReady(message.url);
      } else if (message.type === 'error') {
        reject(new Error('Coordinator startup failed.'));
      }
    });
  });
  child.send({ type: 'start', config });
  try {
    return { child, url: await deadline(ready, 15_000) };
  } catch (error) {
    child.kill();
    throw error;
  }
}

export async function stopInstance(instance: Instance): Promise<void> {
  if (instance.child.exitCode !== null || instance.child.signalCode !== null) {
    return;
  }
  const exited = new Promise<void>((resolveExit) =>
    instance.child.once('exit', () => resolveExit()),
  );
  if (instance.child.connected) {
    instance.child.send({ type: 'close' });
  }
  try {
    await deadline(exited, 5_000);
  } catch {
    instance.child.kill();
    await deadline(exited, 5_000);
  }
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((done, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      done();
    });
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return `http://127.0.0.1:${address.port}`;
}

/** Two real API processes and shared PostgreSQL/Redis. Sandbox/runtime alone are fixtures. */
export async function workerFixture(
  t: TestContext,
  options: {
    dropClaimAck?: boolean;
    dropProposalAck?: boolean;
    dropEvidenceAck?: boolean;
    createEvidenceCollector?: (identity: {
      runnerId: string;
      ownerSubject: string;
      http: RunnerHttpOptions;
    }) => Promise<RunnerEvidenceCollector>;
  } = {},
) {
  const base = loadConfig();
  const redisUrl = base.runner.coordinationRedisUrl;
  if (
    base.runtimeMode !== 'm0-local' ||
    !redisUrl ||
    process.env.M3_WORKER_HTTP_DISPOSABLE !== '1'
  ) {
    throw new Error(
      'Require M3_WORKER_HTTP_DISPOSABLE=1, M0_RUNTIME_MODE=m0-local and disposable PostgreSQL/Redis for this integration proof.',
    );
  }
  const prefix = `worker-http-${randomUUID()}`;
  const applicationId = `${prefix}-app`;
  const connectionId = `${prefix}-connection`;
  const runnerId = `${prefix}-runner`;
  const poolId = `${prefix}-pool`;
  const profileRef = `${prefix}-agent`;
  const profileRevisionId = randomUUID();
  const bindingId = randomUUID();
  const executionId = randomUUID();
  const envelopeId = randomUUID();
  const accountId = `${prefix}-budget`;
  const appToken = randomBytes(32).toString('base64url');
  const runnerToken = randomBytes(32).toString('base64url');
  const config: RuntimeConfig = {
    ...base,
    deploymentRole: 'api-production',
    oidc: undefined,
    localOperatorToken: randomBytes(32).toString('base64url'),
    localRunnerToken: runnerToken,
    applications: [],
    gateway: {},
    telemetry: {},
    allowedHosts: ['127.0.0.1', 'localhost'],
    allowedOrigins: [],
  };
  const db = createDatabaseClient(config);
  const redis = createClient({
    url: redisUrl,
    socket: { connectTimeout: 2_000, reconnectStrategy: false },
  });
  redis.on('error', () => undefined);
  const instances: Instance[] = [];
  const workers: RunnerWorker[] = [];
  let proxy: Server | undefined;
  let target = 0;
  let dropClaimAck = options.dropClaimAck ?? false;
  let dropProposalAck = options.dropProposalAck ?? false;
  let dropEvidenceAck = options.dropEvidenceAck ?? false;
  let grant: RunnerDispatchGrant | undefined;
  let context: RunnerStepContext | undefined;
  const entered = deferred<void>();
  const release = deferred<void>();
  const stopped = deferred<void>();
  const traffic: Array<{
    target: number;
    path: string;
    type?: string;
    status: number;
    dropped: boolean;
  }> = [];
  let executions = 0;
  let launches = 0;
  let stops = 0;

  t.after(async () => {
    release.resolve();
    await Promise.all(workers.map((worker) => worker.stop()));
    if (proxy) {
      const closing = proxy;
      proxy = undefined;
      closing.closeAllConnections();
      await new Promise<void>((done) => closing.close(() => done()));
    }
    await Promise.all(instances.map(stopInstance));
    if (redis.isReady) {
      await redis.del([
        `ai-runtime:m3:lease:${executionId}`,
        runnerPresenceKey('ai-runtime:m3:runner-presence', {
          runnerId,
          ownerSubject: 'local-runner',
          registrationRevision: 1,
        }),
      ]);
    }
    if (redis.isOpen) {
      await redis.close();
    }
    // Exact fixture scope only; no FLUSHDB, global epoch reset, or application seed reset.
    await db.runnerEvidence.deleteMany({ where: { executionId } });
    await db.dispatchEnvelope.deleteMany({ where: { applicationId } });
    await db.runnerAssignment.deleteMany({ where: { executionId } });
    await db.outboxEvent.deleteMany({ where: { applicationId } });
    await db.auditEntry.deleteMany({ where: { applicationId } });
    await db.ledgerEntry.deleteMany({ where: { executionId } });
    await db.usageObservation.deleteMany({ where: { executionId } });
    await db.reservation.deleteMany({ where: { executionId } });
    await db.attempt.deleteMany({ where: { executionId } });
    await db.execution.deleteMany({ where: { id: executionId } });
    await db.budgetProjection.deleteMany({ where: { accountId } });
    await db.budgetAccount.deleteMany({ where: { id: accountId } });
    await db.admissionRateWindow.deleteMany({
      where: { scopeKey: { contains: prefix } },
    });
    await db.credentialInstance.deleteMany({ where: { connectionId } });
    await db.credentialBinding.deleteMany({ where: { id: bindingId } });
    await db.profileAlias.deleteMany({ where: { applicationId } });
    await db.profileRevision.deleteMany({ where: { applicationId } });
    await db.runnerNode.deleteMany({ where: { id: runnerId } });
    await db.runnerPool.deleteMany({ where: { id: poolId } });
    await db.aiConnection.deleteMany({ where: { id: connectionId } });
    await db.controlApplication.deleteMany({ where: { id: applicationId } });
    await db.application.deleteMany({ where: { id: applicationId } });
    await db.$disconnect();
  });

  await db.$connect();
  await redis.connect();
  await db.application.create({
    data: {
      id: applicationId,
      displayName: 'Worker HTTP fixture',
      tokenSha256: createHash('sha256').update(appToken).digest('hex'),
    },
  });
  await db.controlApplication.create({
    data: {
      id: applicationId,
      displayName: 'Worker HTTP fixture',
      environment: 'local',
      keycloakClientId: `${prefix}-client`,
    },
  });
  await db.aiConnection.create({
    data: {
      id: connectionId,
      displayName: 'Worker fixture',
      environment: 'local',
      provider: 'fixture',
      authMode: 'WORKLOAD_IDENTITY',
      sharingMode: 'DEDICATED',
    },
  });
  await db.runnerPool.create({
    data: {
      id: poolId,
      environment: 'local',
      region: 'fixture',
      minimumVersion: '1.0.0',
    },
  });
  await db.runnerNode.create({
    data: {
      id: runnerId,
      ownerSubject: 'local-runner',
      poolId,
      version: '1.0.0',
      capabilities: ['agent_execute'],
      connectionIds: [connectionId],
      capacity: 1,
    },
  });
  await db.credentialInstance.create({
    data: {
      id: `${prefix}-credential`,
      connectionId,
      residency: 'RUNNER_LOCAL',
      runnerRef: runnerId,
    },
  });
  await db.budgetAccount.create({
    data: {
      id: accountId,
      applicationId,
      unit: 'fixture',
      period: 'fixture',
      limitUnits: 100n,
    },
  });
  await db.profileRevision.create({
    data: {
      id: profileRevisionId,
      applicationId,
      profileRef,
      revision: 1,
      connectionId,
      capability: 'agent_execute',
      providerAdapter: 'fixture',
      model: 'fixture-agent',
      maxOutputTokens: 256,
      timeoutMs: 30_000,
      streaming: false,
      holdUnits: 10n,
      accountIds: [accountId],
      digest: randomBytes(32).toString('hex'),
    },
  });
  await db.profileAlias.create({
    data: { applicationId, profileRef, revision: 1, enabled: true },
  });
  await db.credentialBinding.create({
    data: {
      id: bindingId,
      applicationId,
      connectionId,
      profileRef,
      status: 'ENABLED',
    },
  });
  const inputDigest = randomBytes(32).toString('hex');
  // Synthetic metadata only: no payload read/KMS or plugin delivery is claimed.
  await new PrismaDispatchEnvelopeRepository(
    db as unknown as DatabaseService,
  ).createStaged({
    envelopeId,
    applicationId,
    executionBindingId: executionId,
    profileRevisionId,
    inputDigest,
    objectKey: `dispatch-envelopes/v1/${envelopeId}`,
    plaintextSha256: randomBytes(32).toString('hex'),
    ciphertextSha256: randomBytes(32).toString('hex'),
    plaintextBytes: 128,
    ciphertextBytes: 128,
    encryptionAlgorithm: 'AES-256-GCM',
    keyProvider: 'fixture-only',
    keyReference: 'memory://fixture-only',
    wrappedDataKey: randomBytes(60),
    nonce: randomBytes(12),
    authenticationTag: randomBytes(16),
    retentionMs: 300_000,
  });
  await new M1ControlPlaneService(
    new PrismaM1Repository(db as unknown as DatabaseService),
  ).admitDispatchEnvelope(
    {
      subject: applicationId,
      kind: 'application',
      applicationId,
      roles: ['runtime-application'],
      scopes: ['execution:submit'],
    },
    { profileRef, inputDigest },
    `${prefix}-admission`,
    { envelopeId, executionId },
  );
  instances.push(await startInstance(config));
  instances.push(await startInstance(config));
  proxy = createServer((request, response) => {
    void (async () => {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of request) {
        const bytes = Buffer.from(chunk);
        size += bytes.length;
        if (size > 65_536) {
          response.writeHead(413).end();
          return;
        }
        chunks.push(bytes);
      }
      const body = Buffer.concat(chunks);
      const path = request.url!;
      const message = body.length
        ? (JSON.parse(body.toString('utf8')) as { type?: string })
        : {};
      const selected = target;
      const upstream = proxyRequest(
        new URL(path, instances[selected]!.url),
        {
          method: request.method,
          headers: {
            ...request.headers,
            host: new URL(instances[selected]!.url).host,
          },
          timeout: 3_000,
        },
        (reply) => {
          const dropped =
            (reply.statusCode === 202 &&
              dropEvidenceAck &&
              path.endsWith('/evidence')) ||
            (reply.statusCode === 200 &&
              ((dropClaimAck && path.endsWith('/claim')) ||
                (dropProposalAck && message.type === 'result.proposed')));
          traffic.push({
            target: selected,
            path,
            type: message.type,
            status: reply.statusCode!,
            dropped,
          });
          if (dropped) {
            if (path.endsWith('/claim')) {
              dropClaimAck = false;
            } else if (path.endsWith('/evidence')) {
              dropEvidenceAck = false;
            } else {
              dropProposalAck = false;
            }
            reply.once('end', () => response.destroy());
            reply.resume();
            return;
          }
          response.writeHead(reply.statusCode!, reply.headers);
          reply.pipe(response);
        },
      );
      upstream.once('timeout', () => upstream.destroy());
      upstream.once('error', () => response.destroy());
      response.once('close', () => {
        if (!response.writableFinished) {
          upstream.destroy();
        }
      });
      upstream.end(body);
    })().catch(() => response.destroy());
  });
  const origin = await listen(proxy);
  const http: RunnerHttpOptions = {
    origin,
    allowHttpLoopbackForTests: true,
    timeoutMs: 3_000,
    bearerToken: async () => runnerToken,
  };
  const evidenceCollector = await options.createEvidenceCollector?.({
    runnerId,
    ownerSubject: 'local-runner',
    http,
  });

  function makeWorker(execute: RunnerWorkerOptions['runtime']['execute']) {
    const worker = new RunnerWorker({
      runnerId,
      ownerSubject: 'local-runner',
      registrationRevision: 1,
      capacity: 1,
      pollIntervalMs: 100,
      http,
      evidenceCollector,
      driver: {
        async launch() {
          launches++;
          return {
            async requestStop() {
              stops++;
              stopped.resolve();
            },
            async forceStop() {},
            async inspect() {
              return stops ? 'EXITED' : 'RUNNING';
            },
          };
        },
        async recover() {
          return null;
        },
      },
      runtime: { execute },
    });
    workers.push(worker);
    return worker;
  }
  const worker = makeWorker(async (value, scope) => {
    executions++;
    grant = value;
    context = scope;
    entered.resolve();
    await release.promise;
    return {
      outcome: 'completed',
      digest: 'a'.repeat(64),
      artifactIds: [],
      summary: 'fixture result',
    };
  });
  const readAssignment = () =>
    db.runnerAssignment.findFirstOrThrow({ where: { executionId } });
  const evidence = () => ({
    executionId,
    attemptId: grant!.attemptId,
    sourceEventId: 'fixture-call',
    sourceRevision: 1,
    coverage: ['fixture-call'],
    cumulativeUnits: null,
    completeness: 'unknown' as const,
    costBasis: 'unknown' as const,
    reason: 'unknown remote usage',
  });
  const cancel = () =>
    fetch(
      new URL(
        apiContract.controlPlane.cancel.path.replace(':id', executionId),
        instances[1]!.url,
      ),
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${appToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ reason: 'fixture cancel' }),
        signal: AbortSignal.timeout(3_000),
      },
    );
  return {
    worker,
    evidenceCollector,
    db,
    redis,
    instances,
    traffic,
    executionId,
    runnerId,
    accountId,
    release,
    stopped,
    makeWorker,
    readAssignment,
    evidence,
    cancel,
    switchToPeer() {
      target = 1;
    },
    async start() {
      await worker.start();
      await deadline(entered.promise, 10_000);
    },
    get context() {
      assert.ok(context);
      return context;
    },
    get grant() {
      assert.ok(grant);
      return grant;
    },
    get executions() {
      return executions;
    },
    get launches() {
      return launches;
    },
    get stops() {
      return stops;
    },
  };
}
