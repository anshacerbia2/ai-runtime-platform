import { createHash, randomUUID } from 'node:crypto';
import { canonicalJson } from '@ai-runtime/contracts';
import type { RuntimeConfig } from '../config/environment-config.js';
import type { Prisma } from './generated/client.js';

export const playgroundProfileRef = 'playground-chat';

export interface PlaygroundProvisioning {
  applicationId: string;
  provider: 'direct-anthropic' | 'openrouter';
  connectionId: string;
  credentialId: string;
  secretRef: string;
  budgetId: string;
  model: string;
}

// Local-only convenience: when a legacy local provider key is configured, the
// local application gets one ready chat profile so the console Playground works
// without hand-provisioning M1 resources. Never applies outside m0-local.
export function playgroundProvisioning(
  config: RuntimeConfig,
): PlaygroundProvisioning | null {
  const application = config.applications[0];
  if (config.runtimeMode !== 'm0-local' || !application) {
    return null;
  }
  const anthropic = Boolean(config.gateway.anthropicApiKey);
  if (!anthropic && !config.gateway.openrouterApiKey) {
    return null;
  }
  const provider = anthropic ? 'direct-anthropic' : 'openrouter';
  return {
    applicationId: application.id,
    provider,
    connectionId: `local-${provider}`,
    credentialId: `local-${provider}-env`,
    secretRef: anthropic
      ? 'env:M2_ANTHROPIC_API_KEY'
      : 'env:M2_OPENROUTER_API_KEY',
    budgetId: 'local-playground-tokens',
    model:
      config.gateway.playgroundModel ??
      (anthropic ? 'claude-sonnet-5-5' : 'openrouter/auto'),
  };
}

export async function provisionPlayground(
  transaction: Prisma.TransactionClient,
  plan: PlaygroundProvisioning,
) {
  await transaction.aiConnection.upsert({
    where: { id: plan.connectionId },
    create: {
      id: plan.connectionId,
      displayName: `Local ${plan.provider} (Playground)`,
      provider: plan.provider,
      authMode: 'API_KEY',
      environment: 'local',
      sharingMode: 'DEDICATED',
      quotaGroupRef: null,
    },
    update: {},
  });
  await transaction.credentialInstance.upsert({
    where: { id: plan.credentialId },
    create: {
      id: plan.credentialId,
      connectionId: plan.connectionId,
      secretRef: plan.secretRef,
      residency: 'CENTRAL',
      runnerRef: null,
      status: 'ENABLED',
    },
    update: {},
  });
  const binding = await transaction.credentialBinding.findFirst({
    where: {
      applicationId: plan.applicationId,
      connectionId: plan.connectionId,
      profileRef: null,
    },
    select: { id: true },
  });
  if (!binding) {
    await transaction.credentialBinding.create({
      data: {
        id: randomUUID(),
        applicationId: plan.applicationId,
        connectionId: plan.connectionId,
        profileRef: null,
        status: 'ENABLED',
      },
    });
  }
  await transaction.budgetAccount.upsert({
    where: { id: plan.budgetId },
    create: {
      id: plan.budgetId,
      applicationId: plan.applicationId,
      quotaGroupRef: null,
      unit: 'tokens',
      period: 'local',
      limitUnits: 1_000_000n,
    },
    update: {},
  });

  const definition = {
    connectionId: plan.connectionId,
    capability: 'chat',
    providerAdapter: plan.provider,
    model: plan.model,
    maxOutputTokens: 4096,
    timeoutMs: 120_000,
    streaming: true,
    holdUnits: '16384',
    accountIds: [plan.budgetId],
  };
  const latest = await transaction.profileRevision.findFirst({
    where: {
      applicationId: plan.applicationId,
      profileRef: playgroundProfileRef,
    },
    orderBy: { revision: 'desc' },
    select: { revision: true, connectionId: true, model: true },
  });
  if (
    latest &&
    latest.connectionId === plan.connectionId &&
    latest.model === plan.model
  ) {
    return;
  }
  // Revisions are immutable: a changed provider or model publishes the next
  // revision and moves the alias to it.
  const revision = (latest?.revision ?? 0) + 1;
  await transaction.profileRevision.create({
    data: {
      id: randomUUID(),
      applicationId: plan.applicationId,
      profileRef: playgroundProfileRef,
      revision,
      connectionId: definition.connectionId,
      capability: definition.capability,
      providerAdapter: definition.providerAdapter,
      model: definition.model,
      maxOutputTokens: definition.maxOutputTokens,
      timeoutMs: definition.timeoutMs,
      streaming: definition.streaming,
      holdUnits: BigInt(definition.holdUnits),
      accountIds: definition.accountIds,
      digest: createHash('sha256')
        .update(canonicalJson(definition))
        .digest('hex'),
    },
  });
  await transaction.profileAlias.upsert({
    where: {
      applicationId_profileRef: {
        applicationId: plan.applicationId,
        profileRef: playgroundProfileRef,
      },
    },
    create: {
      applicationId: plan.applicationId,
      profileRef: playgroundProfileRef,
      revision,
      enabled: true,
      version: 1,
    },
    update: { revision, enabled: true, version: { increment: 1 } },
  });
}
