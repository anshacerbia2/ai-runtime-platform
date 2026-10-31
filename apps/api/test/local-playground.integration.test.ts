import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../src/infrastructure/config/environment-config.js';
import type { RuntimeConfig } from '../src/infrastructure/config/environment-config.js';
import { createDatabaseClient } from '../src/infrastructure/database/client.js';
import { seedDatabase } from '../src/infrastructure/database/seed.js';
import {
  playgroundProfileRef,
  playgroundProvisioning,
  provisionPlayground,
  type PlaygroundProvisioning,
} from '../src/infrastructure/database/local-playground.seed.js';
import type { DatabaseService } from '../src/infrastructure/database/database.service.js';
import type { Principal } from '../src/modules/identity/domain/principal.js';
import { M1ControlPlaneService } from '../src/modules/control-plane/application/m1-control-plane.service.js';
import { PrismaM1Repository } from '../src/modules/control-plane/infrastructure/prisma-m1.repository.js';
import { GatewayService } from '../src/modules/gateway/application/gateway.service.js';
import type { ProviderAdapter } from '../src/modules/gateway/application/provider-adapter.port.js';
import { ControlPlaneGatewayAdapter } from '../src/modules/gateway/infrastructure/control-plane-gateway.adapter.js';
import { PrismaGatewayRepository } from '../src/modules/gateway/infrastructure/prisma-gateway.repository.js';
import { InMemoryReplayStore } from '../src/modules/gateway/infrastructure/in-memory-replay.store.js';
import { InMemoryGatewayCircuit } from '../src/modules/gateway/infrastructure/in-memory-gateway.circuit.js';
import { Sha256RequestFingerprint } from '../src/modules/gateway/infrastructure/sha256-request-fingerprint.js';
import { BoundedStructuredOutputValidator } from '../src/modules/gateway/infrastructure/structured-output.validator.js';

const prefix = 'playground-' + randomUUID();
const application = {
  id: prefix + '-app',
  name: 'Playground provisioning fixture',
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

function withGateway(gateway: Partial<RuntimeConfig['gateway']>) {
  return {
    ...config,
    gateway: { ...config.gateway, ...gateway },
  } as RuntimeConfig;
}

before(async () => {
  await seedDatabase(db, config);
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

test('provisioning applies only in m0-local with a configured provider key', () => {
  const none = withGateway({
    anthropicApiKey: undefined,
    openrouterApiKey: undefined,
  });
  assert.equal(playgroundProvisioning(none), null);
  assert.equal(
    playgroundProvisioning({
      ...withGateway({ anthropicApiKey: 'k' }),
      runtimeMode: 'nonlocal',
    } as RuntimeConfig),
    null,
  );
  const openrouter = playgroundProvisioning(
    withGateway({ anthropicApiKey: undefined, openrouterApiKey: 'k' }),
  );
  assert.equal(openrouter?.provider, 'openrouter');
  assert.equal(openrouter?.secretRef, 'env:M2_OPENROUTER_API_KEY');
  assert.equal(openrouter?.model, 'openrouter/auto');
  const both = playgroundProvisioning(
    withGateway({
      anthropicApiKey: 'k',
      openrouterApiKey: 'k',
      playgroundModel: 'claude-custom',
    }),
  );
  assert.equal(both?.provider, 'direct-anthropic');
  assert.equal(both?.model, 'claude-custom');
  assert.equal(both?.applicationId, application.id);
});

test('a provisioned playground profile runs a chat through real admission and accounting', async () => {
  await db.$transaction((tx) => provisionPlayground(tx, plan));
  // Idempotent: a second seed publishes nothing new.
  await db.$transaction((tx) => provisionPlayground(tx, plan));
  const revisions = await db.profileRevision.findMany({
    where: { applicationId: application.id, profileRef: playgroundProfileRef },
  });
  assert.equal(revisions.length, 1);

  const calls: string[] = [];
  const provider: ProviderAdapter = {
    id: 'direct-anthropic',
    async *stream(request) {
      calls.push(request.model);
      assert.equal(request.credentialRef, plan.secretRef);
      yield { type: 'started', requestId: 'fixture-request' };
      yield { type: 'delta', text: 'Hello from the playground' };
      yield { type: 'usage', inputTokens: 12, outputTokens: 6 };
      yield {
        type: 'done',
        requestId: 'fixture-request',
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
  const result = await gateway.execute(
    principal,
    {
      profile: playgroundProfileRef,
      capability: 'chat',
      stream: true,
      messages: [{ role: 'user', text: 'hi' }],
      artifactRefs: [],
      fingerprintInput: { messages: [{ role: 'user', text: 'hi' }] },
    },
    prefix + '-turn-1',
  );
  assert.equal(result.status, 'COMPLETED');
  assert.deepEqual(result.result, {
    kind: 'text',
    text: 'Hello from the playground',
  });
  assert.equal(result.usage.totalTokens, 18);
  assert.deepEqual(calls, ['fixture-claude']);
  const budget = await db.budgetAccount.findUniqueOrThrow({
    where: { id: plan.budgetId },
  });
  assert.equal(budget.postedUnits, 18n);
  assert.equal(budget.heldUnits, 0n);

  // A model change publishes the next immutable revision and moves the alias.
  await db.$transaction((tx) =>
    provisionPlayground(tx, { ...plan, model: 'fixture-claude-2' }),
  );
  const alias = await db.profileAlias.findUniqueOrThrow({
    where: {
      applicationId_profileRef: {
        applicationId: application.id,
        profileRef: playgroundProfileRef,
      },
    },
  });
  assert.equal(alias.revision, 2);
});
