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

const PROVIDER_RECOVERY_GRACE_MS = 30_000;
const ADMISSION_CLAIM_GRACE_MS = 60_000;
const RECOVERY_BATCH = 32;

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

  async ownerState(
    claim: GatewayClaim,
  ): Promise<'active' | 'cancelled' | 'fenced'> {
    const execution = await this.db.execution.findFirst({
      where: { id: claim.executionId, applicationId: claim.applicationId },
      select: {
        status: true,
        cancelRequestedAt: true,
        attempts: {
          where: { id: claim.attemptId },
          select: { status: true, ownerInstanceId: true },
        },
      },
    });
    if (execution?.cancelRequestedAt) {
      return 'cancelled';
    }
    if (
      execution?.status !== 'RUNNING' ||
      execution.attempts[0]?.status !== 'RUNNING' ||
      execution.attempts[0]?.ownerInstanceId !== claim.ownerInstanceId
    ) {
      return 'fenced';
    }
    return 'active';
  }

  async claim(
    applicationId: string,
    executionId: string,
    inputDigest: string,
    ownerInstanceId: string,
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
        if (execution.admissionSource !== 'GATEWAY') {
          throw new ApplicationError(
            'IDEMPOTENCY_CONFLICT',
            'Execution was not admitted through the gateway.',
            executionId,
          );
        }
        const application = await tx.$queryRaw<Array<{ status: string }>>`
          SELECT status FROM control.applications WHERE id = ${applicationId} FOR SHARE`;
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
        await tx.$queryRaw`SELECT id FROM control.ai_connections WHERE id = ${execution.profile.connectionId} FOR SHARE`;
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
        const [credential] = await tx.$queryRaw<
          Array<{ id: string; secretRef: string | null }>
        >`SELECT id, secret_ref AS "secretRef" FROM control.credential_instances
          WHERE connection_id = ${connection.id} AND residency = 'CENTRAL'
            AND status = 'ENABLED' AND secret_ref IS NOT NULL
          ORDER BY id LIMIT 1 FOR SHARE`;
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
          await tx.$queryRaw`SELECT id FROM control.ai_connections WHERE id = ${execution.profile.fallbackConnectionId} FOR SHARE`;
          const fallbackConnection = await tx.aiConnection.findUnique({
            where: { id: execution.profile.fallbackConnectionId },
          });
          const fallbackBinding = fallbackConnection
            ? await tx.$queryRaw<Array<{ id: string }>>`
                SELECT id FROM control.credential_bindings
                WHERE application_id = ${applicationId}
                  AND connection_id = ${fallbackConnection.id}
                  AND status = 'ENABLED'
                  AND (profile_ref IS NULL OR profile_ref = ${execution.profile.profileRef})
                ORDER BY id LIMIT 1 FOR SHARE`
            : [];
          const fallbackCredential = fallbackConnection
            ? await tx.$queryRaw<Array<{ secretRef: string }>>`
                SELECT secret_ref AS "secretRef" FROM control.credential_instances
                WHERE connection_id = ${fallbackConnection.id}
                  AND residency = 'CENTRAL' AND status = 'ENABLED'
                  AND secret_ref IS NOT NULL
                ORDER BY id LIMIT 1 FOR SHARE`
            : [];
          if (
            !fallbackConnection ||
            fallbackConnection.status !== 'ENABLED' ||
            fallbackConnection.sharingMode !== 'DEDICATED' ||
            fallbackConnection.provider !== fallbackProvider ||
            fallbackBinding.length === 0 ||
            !fallbackCredential[0]?.secretRef
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
            credentialRef: fallbackCredential[0].secretRef,
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
        if (application[0]?.status !== 'ENABLED') {
          throw new ApplicationError(
            'POLICY_DENIED',
            'Application is not enabled.',
            executionId,
          );
        }
        const primaryBinding = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM control.credential_bindings
          WHERE application_id = ${applicationId}
            AND connection_id = ${connection.id}
            AND status = 'ENABLED'
            AND (profile_ref IS NULL OR profile_ref = ${execution.profile.profileRef})
          ORDER BY id LIMIT 1 FOR SHARE`;
        if (primaryBinding.length === 0) {
          throw new ApplicationError(
            'POLICY_DENIED',
            'Connection is no longer bound to this application/profile.',
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
            ownerInstanceId,
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
            connectionId: connection.id,
            ownerInstanceId,
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
            profile: { select: { profileRef: true } },
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
        const application = await tx.$queryRaw<Array<{ status: string }>>`
          SELECT status FROM control.applications
          WHERE id = ${claim.applicationId} FOR SHARE`;
        if (application[0]?.status !== 'ENABLED') {
          throw new ApplicationError(
            'POLICY_DENIED',
            'Application is not enabled for a new provider attempt.',
            claim.executionId,
          );
        }
        await tx.$queryRaw`SELECT id FROM control.ai_connections WHERE id = ${fallback.connectionId} FOR SHARE`;
        const fallbackConnection = await tx.aiConnection.findUnique({
          where: { id: fallback.connectionId },
        });
        if (
          !fallbackConnection ||
          fallbackConnection.status !== 'ENABLED' ||
          fallbackConnection.sharingMode !== 'DEDICATED' ||
          fallbackConnection.provider !== fallback.provider
        ) {
          throw new ApplicationError(
            'DEPENDENCY_UNAVAILABLE',
            'Fallback connection is no longer eligible.',
            claim.executionId,
          );
        }
        const fallbackBinding = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM control.credential_bindings
          WHERE application_id = ${claim.applicationId}
            AND connection_id = ${fallback.connectionId}
            AND status = 'ENABLED'
            AND (profile_ref IS NULL OR profile_ref = ${execution.profile.profileRef})
          ORDER BY id LIMIT 1 FOR SHARE`;
        const [fallbackCredential] = await tx.$queryRaw<
          Array<{ secretRef: string }>
        >`SELECT secret_ref AS "secretRef" FROM control.credential_instances
          WHERE connection_id = ${fallback.connectionId}
            AND residency = 'CENTRAL' AND status = 'ENABLED'
            AND secret_ref IS NOT NULL
          ORDER BY id LIMIT 1 FOR SHARE`;
        if (fallbackBinding.length === 0 || !fallbackCredential?.secretRef) {
          throw new ApplicationError(
            'POLICY_DENIED',
            'Fallback route authorization was revoked.',
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
        const currentAttempt = await tx.attempt.findUnique({
          where: { id: claim.attemptId },
        });
        if (
          !currentInvocation ||
          currentInvocation.status !== 'RUNNING' ||
          currentInvocation.attemptId !== claim.attemptId ||
          currentAttempt?.status !== 'RUNNING' ||
          currentAttempt.ownerInstanceId !== claim.ownerInstanceId
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
            ownerInstanceId: claim.ownerInstanceId,
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
          connectionId: fallback.connectionId,
          provider: fallback.provider,
          credentialRef: fallbackCredential.secretRef,
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
        throw new ApplicationError(
          'IDEMPOTENCY_CONFLICT',
          'Execution already has a committed provider result.',
          claim.executionId,
        );
      }
      if (execution.status !== 'RUNNING' || execution.cancelRequestedAt) {
        throw new ApplicationError(
          'IDEMPOTENCY_CONFLICT',
          'Execution cannot accept a provider result.',
          claim.executionId,
        );
      }
      const attempt = await tx.attempt.findUnique({
        where: { id: claim.attemptId },
      });
      const invocation = await tx.providerInvocation.findUnique({
        where: { id: claim.invocationId },
      });
      if (
        attempt?.status !== 'RUNNING' ||
        attempt.ownerInstanceId !== claim.ownerInstanceId ||
        invocation?.status !== 'RUNNING' ||
        invocation.attemptId !== claim.attemptId
      ) {
        throw new ApplicationError(
          'IDEMPOTENCY_CONFLICT',
          'Provider attempt has lost completion authority.',
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
  ): Promise<boolean> {
    return this.db.$transaction(async (tx) => {
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
        return false;
      }
      const attempt = await tx.attempt.findUnique({
        where: { id: claim.attemptId },
      });
      const invocation = await tx.providerInvocation.findUnique({
        where: { id: claim.invocationId },
      });
      if (
        attempt?.status !== 'RUNNING' ||
        attempt.ownerInstanceId !== claim.ownerInstanceId ||
        invocation?.status !== 'RUNNING' ||
        invocation.attemptId !== claim.attemptId
      ) {
        return false;
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
      return true;
    });
  }

  private async recoveryClock(): Promise<Date> {
    const epoch = (
      await this.db.$queryRaw<Array<{ epoch_ms: bigint }>>`
        SELECT (extract(epoch FROM clock_timestamp()) * 1000)::bigint AS epoch_ms
      `
    )[0]?.epoch_ms;
    if (epoch === undefined) {
      throw new Error('PostgreSQL did not return a recovery clock.');
    }
    return new Date(Number(epoch));
  }

  /** No provider invocation exists, so the original financial hold can close at zero. */
  async recoverExpiredAdmissions(): Promise<number> {
    const databaseNow = await this.recoveryClock();
    const cutoff = new Date(databaseNow.getTime() - ADMISSION_CLAIM_GRACE_MS);
    const candidates = await this.db.execution.findMany({
      where: {
        admissionSource: 'GATEWAY',
        status: 'ACCEPTED',
        createdAt: { lte: cutoff },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: RECOVERY_BATCH,
      select: { id: true },
    });
    let recovered = 0;
    for (const candidate of candidates) {
      const changed = await this.db.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM control.executions WHERE id=${candidate.id}::uuid FOR UPDATE`;
          const execution = await tx.execution.findUnique({
            where: { id: candidate.id },
            include: {
              attempts: { orderBy: { number: 'asc' }, take: 1 },
              reservations: true,
              providerInvocations: { take: 1 },
              result: true,
            },
          });
          const attempt = execution?.attempts[0];
          if (
            !execution ||
            execution.admissionSource !== 'GATEWAY' ||
            execution.status !== 'ACCEPTED' ||
            execution.createdAt.getTime() > cutoff.getTime() ||
            execution.result ||
            execution.providerInvocations.length ||
            attempt?.status !== 'PREPARED' ||
            execution.reservations.some(
              (item) => item.state !== 'RESERVED' || item.postedUnits !== 0n,
            )
          ) {
            return false;
          }
          const cancelled = Boolean(execution.cancelRequestedAt);
          const code = cancelled
            ? 'CANCELLED_BEFORE_PROVIDER_DISPATCH'
            : 'GATEWAY_CLAIM_DEADLINE_EXCEEDED';
          for (const reservation of [...execution.reservations].sort((a, b) =>
            a.accountId.localeCompare(b.accountId),
          )) {
            await tx.$queryRaw`SELECT id FROM control.budget_accounts WHERE id=${reservation.accountId} FOR UPDATE`;
            const account = await tx.budgetAccount.findUniqueOrThrow({
              where: { id: reservation.accountId },
            });
            if (account.heldUnits < reservation.heldUnits) {
              throw new Error(
                'Gateway admission hold exceeds account exposure.',
              );
            }
            const updated = await tx.budgetAccount.update({
              where: { id: account.id },
              data: {
                heldUnits: { decrement: reservation.heldUnits },
                revision: { increment: 1 },
              },
            });
            await tx.reservation.update({
              where: {
                executionId_accountId: {
                  executionId: execution.id,
                  accountId: reservation.accountId,
                },
              },
              data: {
                heldUnits: 0n,
                state: 'SETTLED',
                revision: { increment: 1 },
              },
            });
            await tx.outboxEvent.create({
              data: {
                id: randomUUID(),
                applicationId: execution.applicationId,
                topic: 'budget.updated',
                aggregateId: account.id,
                revision: updated.revision,
                payload: {
                  account_id: account.id,
                  revision: updated.revision,
                  held_units: updated.heldUnits.toString(),
                  posted_units: updated.postedUnits.toString(),
                },
              },
            });
          }
          await tx.attempt.update({
            where: { id: attempt.id },
            data: {
              status: cancelled ? 'CANCELLED' : 'FAILED',
              authority: 'RELEASED',
              external: 'NONE',
            },
          });
          await tx.execution.update({
            where: { id: execution.id },
            data: {
              status: cancelled ? 'CANCELLED' : 'FAILED',
              statusReason: code,
              completedAt: databaseNow,
              revision: { increment: 1 },
            },
          });
          await tx.outboxEvent.create({
            data: {
              id: randomUUID(),
              applicationId: execution.applicationId,
              topic: cancelled ? 'execution.cancelled' : 'execution.failed',
              aggregateId: execution.id,
              revision: execution.revision + 1,
              payload: { execution_id: execution.id, code },
            },
          });
          return true;
        },
        { isolationLevel: 'ReadCommitted', maxWait: 2000, timeout: 5000 },
      );
      if (changed) {
        recovered++;
      }
    }
    return recovered;
  }

  /** Fence provider work that outlived its profile deadline and grace period.
   * An old owner may still receive a late upstream response, but cannot commit it.
   */
  async recoverExpiredInvocations(): Promise<number> {
    // Use the PostgreSQL clock so an API pod with skew cannot fence a healthy
    // owner earlier than its stored provider deadline.
    const databaseNow = await this.recoveryClock();
    const candidates = await this.db.$queryRaw<
      Array<{ id: string; execution_id: string }>
    >`
      SELECT invocation.id, invocation.execution_id
      FROM control.provider_invocations AS invocation
      JOIN control.executions AS execution ON execution.id = invocation.execution_id
      JOIN control.profile_revisions AS profile ON profile.id = execution.profile_revision_id
      WHERE invocation.status = 'RUNNING'
        AND execution.status = 'RUNNING'
        AND invocation.started_at +
          (profile.timeout_ms + ${PROVIDER_RECOVERY_GRACE_MS}) * interval '1 millisecond' <= ${databaseNow}
      ORDER BY invocation.started_at, invocation.id
      LIMIT ${RECOVERY_BATCH}
    `;
    let recovered = 0;
    for (const candidate of candidates) {
      const changed = await this.db.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM control.executions WHERE id=${candidate.execution_id}::uuid FOR UPDATE`;
          const execution = await tx.execution.findUnique({
            where: { id: candidate.execution_id },
            include: { profile: true, result: true },
          });
          const invocation = await tx.providerInvocation.findUnique({
            where: { id: candidate.id },
          });
          if (
            !execution ||
            execution.status !== 'RUNNING' ||
            execution.result ||
            !invocation ||
            invocation.status !== 'RUNNING' ||
            invocation.executionId !== execution.id ||
            invocation.startedAt.getTime() +
              execution.profile.timeoutMs +
              PROVIDER_RECOVERY_GRACE_MS >
              databaseNow.getTime()
          ) {
            return false;
          }
          const attempt = await tx.attempt.findUnique({
            where: { id: invocation.attemptId },
          });
          if (
            attempt?.status !== 'RUNNING' ||
            attempt.executionId !== execution.id ||
            !attempt.ownerInstanceId
          ) {
            return false;
          }
          const cancelled = Boolean(execution.cancelRequestedAt);
          const code = cancelled
            ? 'CANCELLED_OWNER_DEADLINE'
            : 'PROVIDER_OWNER_DEADLINE_EXCEEDED';
          const status = cancelled ? 'CANCELLED' : 'RECONCILING';
          await tx.providerInvocation.update({
            where: { id: invocation.id },
            data: {
              status: 'UNKNOWN',
              errorCode: code,
              completedAt: databaseNow,
            },
          });
          await tx.attempt.update({
            where: { id: attempt.id },
            data: {
              status: cancelled ? 'CANCELLED' : 'FAILED',
              authority: 'FENCED',
              external: 'UNKNOWN',
            },
          });
          await tx.reservation.updateMany({
            where: { executionId: execution.id, state: 'RESERVED' },
            data: {
              state: 'PENDING_RECONCILIATION',
              revision: { increment: 1 },
            },
          });
          await tx.execution.update({
            where: { id: execution.id },
            data: {
              status,
              statusReason: code,
              completedAt: cancelled ? databaseNow : null,
              revision: { increment: 1 },
            },
          });
          await tx.outboxEvent.create({
            data: {
              id: randomUUID(),
              applicationId: execution.applicationId,
              topic: cancelled
                ? 'execution.cancelled'
                : 'execution.reconciling',
              aggregateId: execution.id,
              revision: execution.revision + 1,
              payload: { execution_id: execution.id, code },
            },
          });
          return true;
        },
        { isolationLevel: 'ReadCommitted', maxWait: 2000, timeout: 5000 },
      );
      if (changed) {
        recovered++;
      }
    }
    return recovered;
  }

  async cancelOwner(
    applicationId: string,
    executionId: string,
  ): Promise<string | null> {
    const attempt = await this.db.attempt.findFirst({
      where: {
        executionId,
        execution: { applicationId },
        status: 'RUNNING',
      },
      orderBy: { number: 'desc' },
      select: { ownerInstanceId: true },
    });
    return attempt?.ownerInstanceId ?? null;
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
