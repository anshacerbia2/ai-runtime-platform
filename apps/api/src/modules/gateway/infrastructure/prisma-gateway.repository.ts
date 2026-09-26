import { randomUUID } from 'node:crypto';
import {
  GatewayExecution,
  GatewayResult,
  type GatewayUsage,
} from '@ai-runtime/contracts/http';
import type { DatabaseService } from '../../../infrastructure/database/database.service.js';
import { ApplicationError } from '../../../shared/domain/application-error.js';
import { databaseJson } from '../../../shared/infrastructure/json-value.js';
import type {
  ClaimResult,
  GatewayClaim,
  GatewayRepository,
} from '../application/gateway-repository.port.js';
import type { ProviderId } from '../application/provider-adapter.port.js';

const provider = (value: string): ProviderId => {
  if (value === 'openrouter' || value === 'direct-anthropic') {
    return value;
  }
  throw new ApplicationError(
    'VERSION_UNSUPPORTED',
    'Profile has no executable provider adapter.',
  );
};

export class PrismaGatewayRepository implements GatewayRepository {
  constructor(private readonly db: DatabaseService) {}

  async claim(
    applicationId: string,
    executionId: string,
    inputDigest: string,
  ): Promise<ClaimResult> {
    return this.db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM control.executions WHERE id=${executionId}::uuid FOR UPDATE`;
        const execution = await tx.execution.findFirst({
          where: { id: executionId, applicationId },
          include: {
            profile: true,
            attempts: { orderBy: { number: 'asc' }, take: 1 },
            providerInvocations: { orderBy: { startedAt: 'desc' }, take: 1 },
            result: true,
          },
        });
        if (!execution) {
          throw new ApplicationError('NOT_FOUND', 'Execution not found.');
        }
        const configuredProvider = provider(execution.profile.providerAdapter);
        if (
          execution.profile.model === 'UNCONFIGURED' ||
          !execution.profile.model.trim()
        ) {
          throw new ApplicationError(
            'VERSION_UNSUPPORTED',
            'Profile has no executable model binding.',
            executionId,
          );
        }
        if (
          !['chat', 'generate', 'structured_generate'].includes(
            execution.profile.capability,
          )
        ) {
          throw new ApplicationError(
            'VERSION_UNSUPPORTED',
            'Profile is not a gateway capability.',
            executionId,
          );
        }
        const connection = await tx.aiConnection.findUnique({
          where: { id: execution.profile.connectionId },
        });
        if (
          !connection ||
          connection.status !== 'ENABLED' ||
          connection.provider !== configuredProvider
        ) {
          throw new ApplicationError(
            'POLICY_DENIED',
            'Profile provider does not match an enabled AI connection.',
            executionId,
          );
        }
        const credential = await tx.credentialInstance.findFirst({
          where: {
            connectionId: connection.id,
            residency: 'CENTRAL',
            status: 'ENABLED',
          },
          select: { id: true, secretRef: true },
        });
        if (!credential?.secretRef) {
          throw new ApplicationError(
            'POLICY_DENIED',
            'No enabled central credential metadata exists for this connection.',
            executionId,
          );
        }
        let fallback: GatewayClaim['fallback'] = null;
        if (
          execution.profile.fallbackConnectionId &&
          execution.profile.fallbackProviderAdapter &&
          execution.profile.fallbackModel
        ) {
          const fallbackProvider = provider(
            execution.profile.fallbackProviderAdapter,
          );
          const fallbackConnection = await tx.aiConnection.findUnique({
            where: { id: execution.profile.fallbackConnectionId },
          });
          const fallbackBinding = fallbackConnection
            ? await tx.credentialBinding.findFirst({
                where: {
                  applicationId,
                  connectionId: fallbackConnection.id,
                  status: 'ENABLED',
                  OR: [
                    { profileRef: null },
                    { profileRef: execution.profile.profileRef },
                  ],
                },
              })
            : null;
          const fallbackCredential = fallbackConnection
            ? await tx.credentialInstance.findFirst({
                where: {
                  connectionId: fallbackConnection.id,
                  residency: 'CENTRAL',
                  status: 'ENABLED',
                  secretRef: { not: null },
                },
                select: { secretRef: true },
              })
            : null;
          if (
            !fallbackConnection ||
            fallbackConnection.status !== 'ENABLED' ||
            fallbackConnection.sharingMode !== 'DEDICATED' ||
            fallbackConnection.provider !== fallbackProvider ||
            !fallbackBinding ||
            !fallbackCredential?.secretRef
          ) {
            throw new ApplicationError(
              'POLICY_DENIED',
              'Configured fallback route is no longer eligible.',
              executionId,
            );
          }
          fallback = {
            connectionId: fallbackConnection.id,
            provider: fallbackProvider,
            credentialRef: fallbackCredential.secretRef,
            model: execution.profile.fallbackModel,
          };
        }
        const accounts = await tx.budgetAccount.findMany({
          where: { id: { in: execution.profile.accountIds } },
          select: { id: true, unit: true },
        });
        if (
          accounts.length !== execution.profile.accountIds.length ||
          accounts.some((account) => account.unit !== 'tokens')
        ) {
          throw new ApplicationError(
            'VERSION_UNSUPPORTED',
            'M2 gateway profiles require token-denominated budget accounts.',
            executionId,
          );
        }
        const result = execution.result
          ? GatewayResult.parse(execution.result.payload)
          : null;
        const invocation = execution.providerInvocations[0];
        const currentProvider = execution.result
          ? provider(execution.result.provider)
          : invocation
            ? provider(invocation.provider)
            : configuredProvider;
        const currentModel =
          execution.result?.model ??
          invocation?.model ??
          execution.profile.model;
        if (result || ['COMPLETED', 'SUCCEEDED'].includes(execution.status)) {
          return {
            state: 'terminal',
            execution: this.present(
              executionId,
              'COMPLETED',
              true,
              currentProvider,
              currentModel,
              result,
              invocation?.inputTokens ?? null,
              invocation?.outputTokens ?? null,
              invocation?.upstreamRequestId ?? null,
              execution.result?.finishReason ?? null,
            ),
            errorCode: null,
          };
        }
        if (execution.status === 'CANCELLED') {
          return {
            state: 'terminal',
            execution: this.present(
              executionId,
              'CANCELLED',
              true,
              currentProvider,
              currentModel,
              null,
              invocation?.inputTokens ?? null,
              invocation?.outputTokens ?? null,
              invocation?.upstreamRequestId ?? null,
              null,
            ),
            errorCode: execution.statusReason,
          };
        }
        if (
          execution.status === 'FAILED' ||
          execution.status === 'RECONCILING'
        ) {
          return {
            state: 'terminal',
            execution: this.present(
              executionId,
              execution.status,
              true,
              currentProvider,
              currentModel,
              null,
              invocation?.inputTokens ?? null,
              invocation?.outputTokens ?? null,
              invocation?.upstreamRequestId ?? null,
              null,
            ),
            errorCode: execution.statusReason,
          };
        }
        if (
          execution.status === 'RUNNING' ||
          invocation?.status === 'RUNNING'
        ) {
          return {
            state: 'terminal',
            execution: this.present(
              executionId,
              'RUNNING',
              true,
              currentProvider,
              currentModel,
              null,
              invocation?.inputTokens ?? null,
              invocation?.outputTokens ?? null,
              invocation?.upstreamRequestId ?? null,
              null,
            ),
            errorCode: null,
          };
        }
        const attempt = execution.attempts[0];
        if (!attempt || attempt.status !== 'PREPARED') {
          throw new ApplicationError(
            'IDEMPOTENCY_CONFLICT',
            'Execution attempt is not claimable.',
            executionId,
          );
        }
        const invocationId = randomUUID();
        await tx.providerInvocation.create({
          data: {
            id: invocationId,
            executionId,
            attemptId: attempt.id,
            connectionId: connection.id,
            provider: configuredProvider,
            model: execution.profile.model,
            status: 'RUNNING',
            requestDigest: inputDigest,
          },
        });
        await tx.attempt.update({
          where: { id: attempt.id },
          data: {
            status: 'RUNNING',
            authority: 'OWNED',
            compute: 'NOT_APPLICABLE',
            external: 'NONE',
          },
        });
        await tx.execution.update({
          where: { id: executionId },
          data: { status: 'RUNNING', revision: { increment: 1 } },
        });
        await tx.outboxEvent.create({
          data: {
            id: randomUUID(),
            applicationId,
            topic: 'execution.started',
            aggregateId: executionId,
            revision: execution.revision + 1,
            payload: {
              execution_id: executionId,
              provider: configuredProvider,
              model: execution.profile.model,
            },
          },
        });
        return {
          state: 'claimed',
          claim: {
            executionId,
            attemptId: attempt.id,
            invocationId,
            applicationId,
            capability: execution.profile
              .capability as GatewayClaim['capability'],
            provider: configuredProvider,
            credentialRef: credential.secretRef,
            model: execution.profile.model,
            fallback,
            maxOutputTokens: execution.profile.maxOutputTokens,
            timeoutMs: execution.profile.timeoutMs,
            streaming: execution.profile.streaming,
            inputDigest,
          },
        };
      },
      { isolationLevel: 'ReadCommitted', maxWait: 2000, timeout: 5000 },
    );
  }
  async beginFallback(
    claim: GatewayClaim,
    reason: string,
  ): Promise<GatewayClaim> {
    const fallback = claim.fallback;
    if (!fallback) {
      throw new ApplicationError(
        'DEPENDENCY_UNAVAILABLE',
        'No policy-approved fallback route is configured.',
        claim.executionId,
      );
    }
    return this.db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM control.executions WHERE id=${claim.executionId}::uuid FOR UPDATE`;
        const execution = await tx.execution.findFirst({
          where: {
            id: claim.executionId,
            applicationId: claim.applicationId,
          },
          include: {
            attempts: { orderBy: { number: 'desc' }, take: 1 },
            result: true,
          },
        });
        if (
          !execution ||
          execution.result ||
          execution.status !== 'RUNNING' ||
          execution.cancelRequestedAt
        ) {
          throw new ApplicationError(
            'IDEMPOTENCY_CONFLICT',
            'Execution cannot start a fallback attempt.',
            claim.executionId,
          );
        }
        const fallbackConnection = await tx.aiConnection.findUnique({
          where: { id: fallback.connectionId },
        });
        if (
          !fallbackConnection ||
          fallbackConnection.status !== 'ENABLED' ||
          fallbackConnection.sharingMode !== 'DEDICATED'
        ) {
          throw new ApplicationError(
            'DEPENDENCY_UNAVAILABLE',
            'Fallback connection is no longer eligible.',
            claim.executionId,
          );
        }
        const routeScope = 'connection:' + fallback.connectionId;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${routeScope}, 0))`;
        const activeFallback = await tx.providerInvocation.count({
          where: {
            connectionId: fallback.connectionId,
            status: 'RUNNING',
          },
        });
        if (activeFallback >= fallbackConnection.gatewayMaxConcurrency) {
          throw new ApplicationError(
            'RESOURCE_EXHAUSTED',
            'Fallback connection concurrency exhausted.',
            claim.executionId,
          );
        }
        const rateRows = await tx.$queryRaw<
          Array<{ request_count: number }>
        >`INSERT INTO control.admission_rate_windows(scope_key, window_start, request_count)
           VALUES (${routeScope}, date_trunc('minute', clock_timestamp()), 1)
           ON CONFLICT(scope_key, window_start) DO UPDATE
             SET request_count = control.admission_rate_windows.request_count + 1
             WHERE control.admission_rate_windows.request_count < ${fallbackConnection.gatewayRequestsPerMinute}
           RETURNING request_count`;
        if (!rateRows.length) {
          throw new ApplicationError(
            'RESOURCE_EXHAUSTED',
            'Fallback connection rate limit exceeded.',
            claim.executionId,
          );
        }
        const currentInvocation = await tx.providerInvocation.findUnique({
          where: { id: claim.invocationId },
        });
        if (
          !currentInvocation ||
          currentInvocation.status !== 'RUNNING' ||
          currentInvocation.attemptId !== claim.attemptId
        ) {
          throw new ApplicationError(
            'IDEMPOTENCY_CONFLICT',
            'Primary provider attempt is no longer fallback-eligible.',
            claim.executionId,
          );
        }
        await tx.providerInvocation.update({
          where: { id: claim.invocationId },
          data: {
            status: 'FAILED',
            errorCode: reason,
            completedAt: new Date(),
          },
        });
        await tx.attempt.update({
          where: { id: claim.attemptId },
          data: {
            status: 'FAILED',
            authority: 'RELEASED',
            compute: 'NOT_APPLICABLE',
            external: 'NONE',
          },
        });
        const nextNumber = (execution.attempts[0]?.number ?? 0) + 1;
        const attemptId = randomUUID();
        const invocationId = randomUUID();
        await tx.attempt.create({
          data: {
            id: attemptId,
            executionId: claim.executionId,
            number: nextNumber,
            status: 'RUNNING',
            authority: 'OWNED',
            compute: 'NOT_APPLICABLE',
            external: 'NONE',
          },
        });
        await tx.providerInvocation.create({
          data: {
            id: invocationId,
            executionId: claim.executionId,
            attemptId,
            connectionId: fallback.connectionId,
            provider: fallback.provider,
            model: fallback.model,
            status: 'RUNNING',
            requestDigest: claim.inputDigest,
          },
        });
        await tx.execution.update({
          where: { id: claim.executionId },
          data: {
            revision: { increment: 1 },
            statusReason: null,
          },
        });
        await tx.outboxEvent.create({
          data: {
            id: randomUUID(),
            applicationId: claim.applicationId,
            topic: 'execution.route-fallback',
            aggregateId: claim.executionId,
            revision: execution.revision + 1,
            payload: {
              execution_id: claim.executionId,
              from_provider: claim.provider,
              to_provider: fallback.provider,
              reason,
              attempt_number: nextNumber,
            },
          },
        });
        return {
          ...claim,
          attemptId,
          invocationId,
          provider: fallback.provider,
          credentialRef: fallback.credentialRef,
          model: fallback.model,
          fallback: null,
        };
      },
      { isolationLevel: 'ReadCommitted', maxWait: 2000, timeout: 5000 },
    );
  }

  async complete(
    claim: GatewayClaim,
    result: GatewayResult,
    usage: GatewayUsage,
    providerRequestId: string | null,
    finishReason: string | null,
  ): Promise<GatewayExecution> {
    await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM control.executions WHERE id=${claim.executionId}::uuid FOR UPDATE`;
      const execution = await tx.execution.findFirst({
        where: { id: claim.executionId, applicationId: claim.applicationId },
        include: { result: true },
      });
      if (!execution) {
        throw new ApplicationError('NOT_FOUND', 'Execution not found.');
      }
      if (execution.result) {
        return;
      }
      if (execution.status !== 'RUNNING' || execution.cancelRequestedAt) {
        throw new ApplicationError(
          'IDEMPOTENCY_CONFLICT',
          'Execution cannot accept a provider result.',
          claim.executionId,
        );
      }
      const completedAt = new Date();
      await tx.executionResult.create({
        data: {
          executionId: claim.executionId,
          kind: result.kind,
          payload: databaseJson(result, 2_097_152),
          provider: claim.provider,
          model: claim.model,
          finishReason,
          providerRequestId,
        },
      });
      await tx.providerInvocation.update({
        where: { id: claim.invocationId },
        data: {
          status: 'SUCCEEDED',
          upstreamRequestId: providerRequestId,
          inputTokens:
            usage.inputTokens === null ? null : BigInt(usage.inputTokens),
          outputTokens:
            usage.outputTokens === null ? null : BigInt(usage.outputTokens),
          completedAt,
        },
      });
      await tx.attempt.update({
        where: { id: claim.attemptId },
        data: {
          status: 'SUCCEEDED',
          authority: 'RELEASED',
          compute: 'NOT_APPLICABLE',
          external: 'NONE',
        },
      });
      await tx.execution.update({
        where: { id: claim.executionId },
        data: {
          status: 'COMPLETED',
          statusReason: null,
          completedAt,
          revision: { increment: 1 },
        },
      });
      await tx.outboxEvent.create({
        data: {
          id: randomUUID(),
          applicationId: claim.applicationId,
          topic: 'execution.completed',
          aggregateId: claim.executionId,
          revision: execution.revision + 1,
          payload: {
            execution_id: claim.executionId,
            provider: claim.provider,
            model: claim.model,
          },
        },
      });
    });
    return this.read(claim.applicationId, claim.executionId);
  }
  async fail(
    claim: GatewayClaim,
    code: string,
    ambiguous: boolean,
    cancelled: boolean,
    usage?: GatewayUsage,
    providerRequestId: string | null = null,
    providerCompleted = false,
  ) {
    await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM control.executions WHERE id=${claim.executionId}::uuid FOR UPDATE`;
      const execution = await tx.execution.findFirst({
        where: { id: claim.executionId, applicationId: claim.applicationId },
        include: { result: true },
      });
      if (
        !execution ||
        execution.result ||
        [
          'COMPLETED',
          'SUCCEEDED',
          'CANCELLED',
          'FAILED',
          'RECONCILING',
        ].includes(execution.status)
      ) {
        return;
      }
      const status = cancelled
        ? 'CANCELLED'
        : ambiguous
          ? 'RECONCILING'
          : 'FAILED';
      const completedAt = cancelled || !ambiguous ? new Date() : null;
      await tx.providerInvocation.updateMany({
        where: { id: claim.invocationId, status: 'RUNNING' },
        data: {
          status: providerCompleted
            ? 'SUCCEEDED'
            : ambiguous
              ? 'UNKNOWN'
              : 'FAILED',
          errorCode: providerCompleted ? null : code,
          upstreamRequestId: providerRequestId,
          inputTokens:
            usage?.inputTokens === null || usage?.inputTokens === undefined
              ? null
              : BigInt(usage.inputTokens),
          outputTokens:
            usage?.outputTokens === null || usage?.outputTokens === undefined
              ? null
              : BigInt(usage.outputTokens),
          completedAt: new Date(),
        },
      });
      await tx.attempt.update({
        where: { id: claim.attemptId },
        data: {
          status: cancelled ? 'CANCELLED' : 'FAILED',
          authority: 'RELEASED',
          compute: 'NOT_APPLICABLE',
          external: providerCompleted
            ? 'COMPLETE'
            : ambiguous
              ? 'UNKNOWN'
              : 'NONE',
        },
      });
      await tx.execution.update({
        where: { id: claim.executionId },
        data: {
          status,
          statusReason: code,
          completedAt,
          revision: { increment: 1 },
        },
      });
      await tx.outboxEvent.create({
        data: {
          id: randomUUID(),
          applicationId: claim.applicationId,
          topic: cancelled
            ? 'execution.cancelled'
            : ambiguous
              ? 'execution.reconciling'
              : 'execution.failed',
          aggregateId: claim.executionId,
          revision: execution.revision + 1,
          payload: { execution_id: claim.executionId, code },
        },
      });
    });
  }

  async read(
    applicationId: string,
    executionId: string,
    replayed = false,
  ): Promise<GatewayExecution> {
    const execution = await this.db.execution.findFirst({
      where: { id: executionId, applicationId },
      include: {
        profile: true,
        result: true,
        providerInvocations: { orderBy: { startedAt: 'desc' }, take: 1 },
      },
    });
    if (!execution) {
      throw new ApplicationError('NOT_FOUND', 'Execution not found.');
    }
    const configuredProvider = provider(execution.profile.providerAdapter);
    const invocation = execution.providerInvocations[0];
    const currentProvider = execution.result
      ? provider(execution.result.provider)
      : invocation
        ? provider(invocation.provider)
        : configuredProvider;
    const currentModel =
      execution.result?.model ?? invocation?.model ?? execution.profile.model;
    const status = normalizeStatus(execution.status);
    return this.present(
      executionId,
      status,
      replayed,
      currentProvider,
      currentModel,
      execution.result ? GatewayResult.parse(execution.result.payload) : null,
      invocation?.inputTokens ?? null,
      invocation?.outputTokens ?? null,
      invocation?.upstreamRequestId ?? null,
      execution.result?.finishReason ?? null,
    );
  }

  private present(
    executionId: string,
    status: GatewayExecution['status'],
    replayed: boolean,
    providerId: ProviderId,
    model: string,
    result: GatewayResult | null,
    input: bigint | null,
    output: bigint | null,
    requestId: string | null,
    finishReason: string | null,
  ): GatewayExecution {
    const inputTokens = safeNumber(input);
    const outputTokens = safeNumber(output);
    return GatewayExecution.parse({
      executionId,
      status,
      replayed,
      provider: providerId,
      model,
      result,
      usage: {
        inputTokens,
        outputTokens,
        totalTokens:
          inputTokens === null || outputTokens === null
            ? null
            : inputTokens + outputTokens,
        completeness:
          inputTokens === null || outputTokens === null
            ? 'unknown'
            : 'complete',
      },
      requestId,
      finishReason,
      links: {
        self: '/v1/executions/' + executionId,
        events: '/v1/executions/' + executionId + '/events',
      },
    });
  }
}
function normalizeStatus(value: string): GatewayExecution['status'] {
  if (value === 'SUCCEEDED' || value === 'COMPLETED') {
    return 'COMPLETED';
  }
  if (
    value === 'RUNNING' ||
    value === 'FAILED' ||
    value === 'RECONCILING' ||
    value === 'CANCELLED'
  ) {
    return value;
  }
  throw new ApplicationError(
    'IDEMPOTENCY_CONFLICT',
    'Execution has not entered the gateway lifecycle.',
  );
}

function safeNumber(value: bigint | null): number | null {
  if (value === null || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    return null;
  }
  return Number(value);
}
