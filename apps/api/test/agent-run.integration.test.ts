import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../src/infrastructure/config/environment-config.js';
import { createDatabaseClient } from '../src/infrastructure/database/client.js';
import { seedDatabase } from '../src/infrastructure/database/seed.js';
import {
  playgroundProfileRef,
  provisionPlayground,
  type PlaygroundProvisioning,
} from '../src/infrastructure/database/local-playground.seed.js';
import type { DatabaseService } from '../src/infrastructure/database/database.service.js';
import type { Principal } from '../src/modules/identity/domain/principal.js';
import { M1ControlPlaneService } from '../src/modules/control-plane/application/m1-control-plane.service.js';
import { PrismaM1Repository } from '../src/modules/control-plane/infrastructure/prisma-m1.repository.js';
import { GatewayService } from '../src/modules/gateway/application/gateway.service.js';
import type {
  ProviderAdapter,
  ProviderRequest,
} from '../src/modules/gateway/application/provider-adapter.port.js';
import { ControlPlaneGatewayAdapter } from '../src/modules/gateway/infrastructure/control-plane-gateway.adapter.js';
import { PrismaGatewayRepository } from '../src/modules/gateway/infrastructure/prisma-gateway.repository.js';
import { InMemoryReplayStore } from '../src/modules/gateway/infrastructure/in-memory-replay.store.js';
import { InMemoryGatewayCircuit } from '../src/modules/gateway/infrastructure/in-memory-gateway.circuit.js';
import { Sha256RequestFingerprint } from '../src/modules/gateway/infrastructure/sha256-request-fingerprint.js';
import { BoundedStructuredOutputValidator } from '../src/modules/gateway/infrastructure/structured-output.validator.js';
import {
  RunAgentUseCase,
  type AgentRunUpdate,
} from '../src/modules/agent-runtime/application/run-agent.use-case.js';
import { GatewayAgentCapabilities } from '../src/modules/agent-runtime/infrastructure/gateway-agent-capabilities.js';

const prefix = 'agent-' + randomUUID();
const application = {
  id: prefix + '-app',
  name: 'Agent preview fixture',
  token: randomUUID() + randomUUID(),
};
const config = { ...loadConfig(), applications: [application] };
const db = createDatabaseClient(config);
const plan: PlaygroundProvisioning = {
  applicationId: application.id,
  provider: 'direct-anthropic',
  connectionId: prefix + '-connection',
  credentialId: prefix + '-credential',
  secretRef: 'env:M2_ANTHROPIC_API_KEY',
  budgetId: prefix + '-budget',
  model: 'fixture-claude',
};
const principal: Principal = {
  subject: application.id,
  kind: 'application',
  applicationId: application.id,
  roles: ['runtime-application'],
  scopes: ['execution:submit', 'execution:read', 'execution:cancel'],
};

before(async () => {
  await seedDatabase(db, config);
  await db.$transaction((tx) => provisionPlayground(tx, plan));
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
  await db.budgetProjection.deleteMany({ where: { accountId: plan.budgetId } });
  await db.budgetAccount.deleteMany({ where: { id: plan.budgetId } });
  await db.credentialBinding.deleteMany({
    where: { applicationId: application.id },
  });
  await db.credentialInstance.deleteMany({ where: { id: plan.credentialId } });
  await db.aiConnection.deleteMany({ where: { id: plan.connectionId } });
  await db.auditEntry.deleteMany({ where: { applicationId: application.id } });
  await db.admissionRateWindow.deleteMany({
    where: { scopeKey: { contains: prefix } },
  });
  await db.controlApplication.deleteMany({ where: { id: application.id } });
  await db.profile.deleteMany({ where: { applicationId: application.id } });
  await db.application.deleteMany({ where: { id: application.id } });
  await db.$disconnect();
});

test('an agent run uses a tool between two admitted, accounted gateway executions', async () => {
  const requests: ProviderRequest[] = [];
  // Scripted model: ask for the calculator, then answer from its result.
  const provider: ProviderAdapter = {
    id: 'direct-anthropic',
    async *stream(request) {
      requests.push(request);
      const last = request.messages.at(-1)?.text ?? '';
      const reply = last.startsWith('Tool result for calculate')
        ? JSON.stringify({
            thought: 'The tool returned the product.',
            final: `17 × 23 = ${/"result":(\d+)/.exec(last)?.[1] ?? '?'}`,
          })
        : JSON.stringify({
            thought: 'Multiply exactly.',
            tool: 'calculate',
            arguments: { expression: '17*23' },
          });
      yield { type: 'started', requestId: 'fixture-' + requests.length };
      yield { type: 'delta', text: reply };
      yield { type: 'usage', inputTokens: 40, outputTokens: 10 };
      yield {
        type: 'done',
        requestId: 'fixture-' + requests.length,
        finishReason: 'end_turn',
      };
    },
  };
  const m1 = new PrismaM1Repository(db as unknown as DatabaseService);
  const gateway = new GatewayService(
    new ControlPlaneGatewayAdapter(new M1ControlPlaneService(m1), m1),
    new PrismaGatewayRepository(db as unknown as DatabaseService),
    [provider],
    new InMemoryReplayStore(),
    new Sha256RequestFingerprint(),
    new BoundedStructuredOutputValidator(),
    randomUUID(),
    new InMemoryGatewayCircuit(),
  );
  const updates: AgentRunUpdate[] = [];
  const status = await new RunAgentUseCase(
    new GatewayAgentCapabilities(gateway),
  ).run(
    principal,
    {
      runId: randomUUID(),
      profile: playgroundProfileRef,
      input: 'What is 17 * 23?',
      system: null,
      history: [],
      tools: null,
      maxSteps: 4,
      maxOutputTokens: 1024,
      tokenBudget: 50_000,
    },
    (update) => {
      updates.push(update);
    },
    new AbortController().signal,
  );

  assert.equal(status, 'COMPLETED');
  const done = updates.at(-1);
  assert.equal(done?.type, 'run.completed');
  assert.equal(done?.type === 'run.completed' && done.answer, '17 × 23 = 391');
  const tool = updates.find((update) => update.type === 'tool.completed');
  assert.deepEqual(
    tool?.type === 'tool.completed' && [tool.status, tool.output],
    ['SUCCEEDED', '{"expression":"17*23","result":391}'],
  );
  // The real calculator ran between the two model calls.
  assert.equal(requests.length, 2);
  assert.match(requests[1]?.messages.at(-1)?.text ?? '', /"result":391/);
  assert.equal(requests[0]?.messages[0]?.role, 'system');
  assert.match(requests[0]?.messages[0]?.text ?? '', /calculate/);

  // Each model step is a separate, completed, accounted execution.
  const dispatched = updates.flatMap((update) =>
    update.type === 'model.dispatched' ? [update.executionId] : [],
  );
  assert.equal(new Set(dispatched).size, 2);
  const executions = await db.execution.findMany({
    where: { applicationId: application.id },
  });
  assert.equal(executions.length, 2);
  assert.ok(executions.every((item) => item.status === 'COMPLETED'));
  const budget = await db.budgetAccount.findUniqueOrThrow({
    where: { id: plan.budgetId },
  });
  assert.equal(budget.postedUnits, 100n);
  assert.equal(budget.heldUnits, 0n);

  // execution_lookup reads the caller's own execution through the gateway.
  const lookup = await new GatewayAgentCapabilities(gateway)
    .forCaller(principal)
    .tools.invoke({
      identity: {
        runId: 'r',
        turnId: null,
        operationId: 'r:tool:1',
        caller: {
          applicationId: application.id,
          tenantId: null,
          principalSubject: application.id,
        },
        requestDigest: 'd',
      },
      bindingId: 'builtin:execution_lookup:v1',
      operation: 'execution_lookup',
      arguments: { execution_id: dispatched[0] },
      deadlineMs: 1000,
      allocation: null,
    });
  assert.equal(lookup.state, 'SUCCEEDED');
  assert.equal(
    lookup.state === 'SUCCEEDED' &&
      (lookup.result as { status: string; usage: { totalTokens: number } })
        .usage.totalTokens,
    50,
  );
});

test('a run against a missing profile stops with the gateway refusal code', async () => {
  const m1 = new PrismaM1Repository(db as unknown as DatabaseService);
  const gateway = new GatewayService(
    new ControlPlaneGatewayAdapter(new M1ControlPlaneService(m1), m1),
    new PrismaGatewayRepository(db as unknown as DatabaseService),
    [],
    new InMemoryReplayStore(),
    new Sha256RequestFingerprint(),
    new BoundedStructuredOutputValidator(),
    randomUUID(),
    new InMemoryGatewayCircuit(),
  );
  const updates: AgentRunUpdate[] = [];
  const status = await new RunAgentUseCase(
    new GatewayAgentCapabilities(gateway),
  ).run(
    principal,
    {
      runId: randomUUID(),
      profile: 'no-such-profile',
      input: 'hi',
      system: null,
      history: [],
      tools: null,
      maxSteps: 2,
      maxOutputTokens: 256,
      tokenBudget: 5_000,
    },
    (update) => {
      updates.push(update);
    },
    new AbortController().signal,
  );
  assert.equal(status, 'FAILED');
  const stop = updates.at(-1);
  assert.equal(stop?.type === 'run.stopped' && stop.code, 'NOT_FOUND');
});
