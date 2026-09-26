import { ManagementResult, receiptPolicy } from '@ai-runtime/contracts/http';
import { presentRunner, presentAudit, presentOutbox } from './wire-mappers.js';
import { databaseJson } from '../../../shared/infrastructure/json-value.js';
import { createHash, randomUUID } from 'node:crypto';
import type {
  AdmissionCommand,
  ArtifactCommand,
  ManagementCommand,
  RunnerRegistration,
  UsageCommand,
} from '@ai-runtime/contracts';
import { canonicalJson } from '@ai-runtime/contracts';
import { Prisma } from '../../../infrastructure/database/generated/client.js';
import type { DatabaseService } from '../../../infrastructure/database/database.service.js';
import { ApplicationError } from '../../../shared/domain/application-error.js';
import type { Principal } from '../../identity/domain/principal.js';
import type {
  AdmissionResult,
  ExecutionView,
  M1Repository,
  UsageResult,
} from '../application/m1-repository.port.js';

const asString = (value: bigint) => value.toString();
const digest = (value: string) =>
  createHash('sha256').update(value).digest('hex');
const jsonDigest = (value: unknown) => digest(canonicalJson(value));
const positive = (value: bigint) => (value > 0n ? value : 0n);

function requireApplication(principal: Principal) {
  if (principal.kind !== 'application' || !principal.applicationId) {
    throw new ApplicationError(
      'POLICY_DENIED',
      'Application principal required.',
    );
  }
  return principal.applicationId;
}

function isPrismaCode(error: unknown, code: string) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === code
  );
}

function retryableTransactionError(error: unknown, depth = 0): boolean {
  if (depth > 4 || typeof error !== 'object' || error === null) {
    return false;
  }
  const record = error as Record<string, unknown>;
  if (
    record.code === 'P2034' ||
    record.code === '40001' ||
    record.code === '40P01' ||
    record.originalCode === '40001' ||
    record.originalCode === '40P01' ||
    record.kind === 'TransactionWriteConflict'
  ) {
    return true;
  }
  if (
    typeof record.message === 'string' &&
    /serialize access|serialization failure|deadlock detected/i.test(
      record.message,
    )
  ) {
    return true;
  }
  if (
    typeof record.originalMessage === 'string' &&
    /serialize access|serialization failure|deadlock detected/i.test(
      record.originalMessage,
    )
  ) {
    return true;
  }
  return (
    retryableTransactionError(record.cause, depth + 1) ||
    retryableTransactionError(record.meta, depth + 1)
  );
}

async function transactionBackoff(retry: number) {
  await new Promise((resolve) =>
    setTimeout(resolve, Math.min(250, 5 * (retry + 1))),
  );
}

function conflict(message: string): never {
  throw new ApplicationError('IDEMPOTENCY_CONFLICT', message);
}

function notFound(message = 'Resource not found.'): never {
  throw new ApplicationError('NOT_FOUND', message);
}

export class PrismaM1Repository implements M1Repository {
  constructor(private readonly database: DatabaseService) {}

  async readSnapshot(principal: Principal) {
    if (principal.kind === 'application') {
      const applicationId = requireApplication(principal);
      const [application, bindings, profiles, budgets, executions] =
        await Promise.all([
          this.database.controlApplication.findUnique({
            where: { id: applicationId },
            select: {
              id: true,
              displayName: true,
              environment: true,
              keycloakClientId: true,
              gatewayMaxConcurrency: true,
              gatewayRequestsPerMinute: true,
              status: true,
              revision: true,
            },
          }),
          this.database.credentialBinding.findMany({
            take: 201,
            where: { applicationId },
            select: {
              id: true,
              applicationId: true,
              connectionId: true,
              profileRef: true,
              status: true,
              revision: true,
            },
            orderBy: [{ connectionId: 'asc' }, { id: 'asc' }],
          }),
          this.database.profileRevision.findMany({
            take: 201,
            where: { applicationId },
            select: {
              id: true,
              profileRef: true,
              revision: true,
              connectionId: true,
              capability: true,
              providerAdapter: true,
              model: true,
              fallbackConnectionId: true,
              fallbackProviderAdapter: true,
              fallbackModel: true,
              maxOutputTokens: true,
              timeoutMs: true,
              streaming: true,
              holdUnits: true,
              accountIds: true,
              digest: true,
            },
            orderBy: [{ profileRef: 'asc' }, { revision: 'desc' }],
          }),
          this.database.budgetAccount.findMany({
            take: 201,
            where: { applicationId },
            select: {
              id: true,
              unit: true,
              period: true,
              limitUnits: true,
              heldUnits: true,
              postedUnits: true,
              revision: true,
            },
            orderBy: { id: 'asc' },
          }),
          this.database.execution.findMany({
            where: { applicationId },
            select: { id: true, status: true, revision: true, createdAt: true },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: 50,
          }),
        ]);
      if ([bindings, profiles, budgets].some((rows) => rows.length > 200)) {
        throw new ApplicationError(
          'RESOURCE_EXHAUSTED',
          'Legacy snapshot capacity exceeded; use paginated resource APIs.',
        );
      }
      return {
        application,
        bindings,
        profiles: profiles.map((item) => ({
          ...item,
          holdUnits: asString(item.holdUnits),
        })),
        budgets: budgets.map((item) => ({
          ...item,
          limitUnits: asString(item.limitUnits),
          heldUnits: asString(item.heldUnits),
          postedUnits: asString(item.postedUnits),
        })),
        executions: executions.map((item) => ({
          ...item,
          createdAt: item.createdAt.toISOString(),
        })),
      };
    }

    const [
      applications,
      connections,
      credentials,
      bindings,
      aliases,
      profiles,
      budgets,
      pools,
      runners,
    ] = await Promise.all([
      this.database.controlApplication.findMany({
        take: 201,
        select: {
          id: true,
          displayName: true,
          environment: true,
          keycloakClientId: true,
          gatewayMaxConcurrency: true,
          gatewayRequestsPerMinute: true,
          status: true,
          revision: true,
        },
        orderBy: [{ environment: 'asc' }, { id: 'asc' }],
      }),
      this.database.aiConnection.findMany({
        take: 201,
        select: {
          id: true,
          displayName: true,
          provider: true,
          authMode: true,
          environment: true,
          sharingMode: true,
          quotaGroupRef: true,
          gatewayMaxConcurrency: true,
          gatewayRequestsPerMinute: true,
          status: true,
          revision: true,
        },
        orderBy: [{ environment: 'asc' }, { id: 'asc' }],
      }),
      this.database.credentialInstance.findMany({
        take: 201,
        select: {
          id: true,
          connectionId: true,
          residency: true,
          runnerRef: true,
          status: true,
          revision: true,
        },
        orderBy: [{ connectionId: 'asc' }, { id: 'asc' }],
      }),
      this.database.credentialBinding.findMany({
        take: 201,
        select: {
          id: true,
          applicationId: true,
          connectionId: true,
          profileRef: true,
          status: true,
          revision: true,
        },
        orderBy: [{ applicationId: 'asc' }, { connectionId: 'asc' }],
      }),
      this.database.profileAlias.findMany({
        take: 201,
        orderBy: [{ applicationId: 'asc' }, { profileRef: 'asc' }],
      }),
      this.database.profileRevision.findMany({
        take: 201,
        select: {
          id: true,
          applicationId: true,
          profileRef: true,
          revision: true,
          connectionId: true,
          capability: true,
          providerAdapter: true,
          model: true,
          fallbackConnectionId: true,
          fallbackProviderAdapter: true,
          fallbackModel: true,
          maxOutputTokens: true,
          timeoutMs: true,
          streaming: true,
          holdUnits: true,
          accountIds: true,
          digest: true,
          createdAt: true,
        },
        orderBy: [
          { applicationId: 'asc' },
          { profileRef: 'asc' },
          { revision: 'desc' },
        ],
      }),
      this.database.budgetAccount.findMany({
        take: 201,
        orderBy: { id: 'asc' },
      }),
      this.database.runnerPool.findMany({ take: 201, orderBy: { id: 'asc' } }),
      this.database.runnerNode.findMany({
        take: 201,
        select: {
          id: true,
          ownerSubject: true,
          poolId: true,
          version: true,
          capabilities: true,
          connectionIds: true,
          capacity: true,
          status: true,
          revision: true,
          lastHeartbeatAt: true,
        },
        orderBy: { id: 'asc' },
      }),
    ]);

    if (
      [
        applications,
        connections,
        credentials,
        bindings,
        aliases,
        profiles,
        budgets,
        pools,
        runners,
      ].some((rows) => rows.length > 200)
    ) {
      throw new ApplicationError(
        'RESOURCE_EXHAUSTED',
        'Legacy snapshot capacity exceeded; use paginated resource APIs.',
      );
    }
    return {
      applications,
      connections,
      credentials,
      bindings,
      aliases,
      profiles: profiles.map((item) => ({
        ...item,
        holdUnits: asString(item.holdUnits),
        createdAt: item.createdAt.toISOString(),
      })),
      budgets: budgets.map((item) => ({
        ...item,
        limitUnits: asString(item.limitUnits),
        heldUnits: asString(item.heldUnits),
        postedUnits: asString(item.postedUnits),
      })),
      pools,
      runners: runners.map((item) => ({
        ...item,
        lastHeartbeatAt: item.lastHeartbeatAt.toISOString(),
      })),
    };
  }

  private async transaction<T>(
    work: (tx: Prisma.TransactionClient) => Promise<T>,
    bounded = false,
  ): Promise<T> {
    const deadline = Date.now() + 15000;
    for (let retry = 0; ; retry++) {
      if (bounded && Date.now() >= deadline) {
        throw new ApplicationError(
          'DEPENDENCY_UNAVAILABLE',
          'Transaction replay budget exhausted; reconcile the request key.',
        );
      }
      try {
        return await this.database.$transaction(work, {
          isolationLevel: 'Serializable',
          maxWait: bounded
            ? Math.max(1, Math.min(2000, deadline - Date.now()))
            : 15000,
          timeout: bounded
            ? Math.max(1, Math.min(5000, deadline - Date.now()))
            : 15000,
        });
      } catch (error) {
        if (
          (retryableTransactionError(error) || isPrismaCode(error, 'P2002')) &&
          retry < (bounded ? 5 : 64)
        ) {
          await transactionBackoff(retry);
          continue;
        }
        if (isPrismaCode(error, 'P2002')) {
          conflict('Resource identity already exists.');
        }
        if (isPrismaCode(error, 'P2003')) {
          throw new ApplicationError(
            'INVALID_REQUEST',
            'Referenced resource does not exist.',
          );
        }
        throw error;
      }
    }
  }

  async manage(principal: Principal, command: ManagementCommand) {
    return this.transaction((tx) => this.manageIn(tx, principal, command));
  }

  /** Shared use case for compatibility and resource APIs; the caller owns the transaction. */
  async manageIn(
    tx: Prisma.TransactionClient,
    principal: Principal,
    command: ManagementCommand,
  ) {
    const result = await this.applyManagement(tx, principal, command);
    return ManagementResult.parse({ ...result, kind: command.kind });
  }

  async manageReceipted(
    principal: Principal,
    command: ManagementCommand,
    key: string,
  ) {
    const scopeKey = digest(principal.kind + ':' + principal.subject);
    const requestDigest = jsonDigest({
      version: 1,
      operation: command.kind,
      command,
    });
    const id = randomUUID();
    return this.transaction(async (tx) => {
      // In-progress claims remain invisible until this SHORT transaction commits.
      const inserted = await tx.managementReceipt.createMany({
        data: [
          {
            id,
            scopeKey,
            requestKey: key,
            operation: command.kind,
            requestDigest,
            response: {},
            completed: false,
            expiresAt: new Date(Date.now() + receiptPolicy.replayWindowMs),
          },
        ],
        skipDuplicates: true,
      });
      const prior = await tx.managementReceipt.findUniqueOrThrow({
        where: { scopeKey_requestKey: { scopeKey, requestKey: key } },
      });
      if (inserted.count === 0) {
        if (
          prior.requestDigest !== requestDigest ||
          prior.operation !== command.kind
        ) {
          conflict('Request key belongs to a different operation or payload.');
        }
        if (!prior.completed || !prior.completedAt) {
          throw new ApplicationError(
            'DEPENDENCY_UNAVAILABLE',
            'The first operation has not completed.',
          );
        }
        if (prior.expiresAt.getTime() <= Date.now()) {
          throw new ApplicationError(
            'REQUEST_KEY_EXPIRED',
            'Receipt replay window expired; the key is retained and cannot be reused.',
          );
        }
        return {
          resource: ManagementResult.parse(prior.response),
          receipt: {
            id: prior.id,
            key,
            replayed: true,
            completedAt: prior.completedAt.toISOString(),
          },
        };
      }
      const resource = await this.manageIn(tx, principal, command);
      const completedAt = new Date();
      await tx.managementReceipt.update({
        where: { id },
        data: {
          response: databaseJson(resource),
          completed: true,
          completedAt,
        },
      });
      return {
        resource,
        receipt: {
          id,
          key,
          replayed: false,
          completedAt: completedAt.toISOString(),
        },
      };
    }, true);
  }

  private async applyManagement(
    tx: Prisma.TransactionClient,
    principal: Principal,
    command: ManagementCommand,
  ) {
    const actor = principal.subject;
    const audited = async (
      action: string,
      resourceId: string,
      revision: number,
      applicationId: string | null = null,
    ) => {
      await tx.auditEntry.create({
        data: {
          id: randomUUID(),
          actor,
          action,
          resourceId,
          revision,
          applicationId,
        },
      });
    };

    if (command.kind === 'application') {
      const current = await tx.controlApplication.findUnique({
        where: { id: command.id },
      });
      if (command.expectedRevision === 0) {
        if (current) {
          conflict('Application already exists.');
        }
        const created = await tx.controlApplication.create({
          data: {
            id: command.id,
            displayName: command.displayName,
            environment: command.environment,
            keycloakClientId: command.keycloakClientId,
            gatewayMaxConcurrency: command.gatewayMaxConcurrency ?? 100,
            gatewayRequestsPerMinute: command.gatewayRequestsPerMinute ?? 600,
            status: command.status,
          },
          select: {
            id: true,
            displayName: true,
            environment: true,
            keycloakClientId: true,
            gatewayMaxConcurrency: true,
            gatewayRequestsPerMinute: true,
            status: true,
            revision: true,
          },
        });
        await audited(
          'application.created',
          created.id,
          created.revision,
          created.id,
        );
        return created;
      }
      if (!current) {
        notFound();
      }
      if (current.revision !== command.expectedRevision) {
        conflict('Application revision changed.');
      }
      const updated = await tx.controlApplication.update({
        where: { id: command.id },
        data: {
          displayName: command.displayName,
          environment: command.environment,
          keycloakClientId: command.keycloakClientId,
          gatewayMaxConcurrency:
            command.gatewayMaxConcurrency ?? current.gatewayMaxConcurrency,
          gatewayRequestsPerMinute:
            command.gatewayRequestsPerMinute ??
            current.gatewayRequestsPerMinute,
          status: command.status,
          revision: { increment: 1 },
        },
        select: {
          id: true,
          displayName: true,
          environment: true,
          keycloakClientId: true,
          gatewayMaxConcurrency: true,
          gatewayRequestsPerMinute: true,
          status: true,
          revision: true,
        },
      });
      await audited(
        'application.updated',
        updated.id,
        updated.revision,
        updated.id,
      );
      return updated;
    }

    if (command.kind === 'connection') {
      const current = await tx.aiConnection.findUnique({
        where: { id: command.id },
      });
      if (command.sharingMode === 'SHARED' && !command.quotaGroupRef) {
        throw new ApplicationError(
          'INVALID_REQUEST',
          'Shared connection requires quotaGroupRef.',
        );
      }
      if (command.sharingMode === 'DEDICATED') {
        const owners = await tx.credentialBinding.findMany({
          where: { connectionId: command.id, status: 'ENABLED' },
          distinct: ['applicationId'],
          select: { applicationId: true },
        });
        if (owners.length > 1) {
          conflict(
            'Shared connection still has multiple application bindings.',
          );
        }
      }
      const gatewayMaxConcurrency =
        command.gatewayMaxConcurrency ?? current?.gatewayMaxConcurrency ?? 100;
      const gatewayRequestsPerMinute =
        command.gatewayRequestsPerMinute ??
        current?.gatewayRequestsPerMinute ??
        600;
      if (command.sharingMode === 'SHARED') {
        const peers = await tx.aiConnection.findMany({
          where: {
            id: { not: command.id },
            sharingMode: 'SHARED',
            quotaGroupRef: command.quotaGroupRef,
            status: 'ENABLED',
          },
          select: {
            gatewayMaxConcurrency: true,
            gatewayRequestsPerMinute: true,
          },
        });
        if (
          peers.some(
            (peer) =>
              peer.gatewayMaxConcurrency !== gatewayMaxConcurrency ||
              peer.gatewayRequestsPerMinute !== gatewayRequestsPerMinute,
          )
        ) {
          throw new ApplicationError(
            'INVALID_REQUEST',
            'Shared quota-group connections must use identical gateway limits.',
          );
        }
      }
      const data = {
        displayName: command.displayName,
        environment: command.environment,
        provider: command.provider,
        authMode: command.authMode,
        sharingMode: command.sharingMode,
        quotaGroupRef: command.quotaGroupRef,
        gatewayMaxConcurrency,
        gatewayRequestsPerMinute,
        status: command.status,
      };
      if (command.expectedRevision === 0) {
        if (current) {
          conflict('Connection already exists.');
        }
        const created = await tx.aiConnection.create({
          data: { id: command.id, ...data },
        });
        await audited('connection.created', created.id, created.revision);
        return created;
      }
      if (!current) {
        notFound();
      }
      if (current.revision !== command.expectedRevision) {
        conflict('Connection revision changed.');
      }
      const updated = await tx.aiConnection.update({
        where: { id: command.id },
        data: { ...data, revision: { increment: 1 } },
      });
      await audited('connection.updated', updated.id, updated.revision);
      return updated;
    }

    if (command.kind === 'credential') {
      const connection = await tx.aiConnection.findUnique({
        where: { id: command.connectionId },
      });
      if (!connection) {
        notFound('Connection not found.');
      }
      if (
        (command.residency === 'RUNNER_LOCAL' && !command.runnerRef) ||
        (command.residency === 'CENTRAL' && command.runnerRef)
      ) {
        throw new ApplicationError(
          'INVALID_REQUEST',
          'Credential residency and runnerRef disagree.',
        );
      }
      const current = await tx.credentialInstance.findUnique({
        where: { id: command.id },
      });
      const data = {
        connectionId: command.connectionId,
        secretRef:
          command.secretRef === undefined
            ? (current?.secretRef ?? null)
            : command.secretRef,
        residency: command.residency,
        runnerRef: command.runnerRef,
        status: command.status,
      };
      let result;
      if (command.expectedRevision === 0) {
        if (current) {
          conflict('Credential metadata already exists.');
        }
        result = await tx.credentialInstance.create({
          data: { id: command.id, ...data },
        });
      } else {
        if (!current) {
          notFound();
        }
        if (current.revision !== command.expectedRevision) {
          conflict('Credential revision changed.');
        }
        result = await tx.credentialInstance.update({
          where: { id: command.id },
          data: { ...data, revision: { increment: 1 } },
        });
      }
      await audited(
        command.expectedRevision === 0
          ? 'credential.created'
          : 'credential.updated',
        result.id,
        result.revision,
      );
      return {
        id: result.id,
        connectionId: result.connectionId,
        residency: result.residency,
        runnerRef: result.runnerRef,
        status: result.status,
        revision: result.revision,
      };
    }

    if (command.kind === 'binding') {
      const application = await tx.controlApplication.findUnique({
        where: { id: command.applicationId },
      });
      const connection = await tx.aiConnection.findUnique({
        where: { id: command.connectionId },
      });
      if (!application || !connection) {
        notFound('Application or connection not found.');
      }
      if (connection.sharingMode === 'DEDICATED') {
        const other = await tx.credentialBinding.findFirst({
          where: {
            connectionId: command.connectionId,
            status: 'ENABLED',
            applicationId: { not: command.applicationId },
          },
        });
        if (other) {
          throw new ApplicationError(
            'POLICY_DENIED',
            'Dedicated connection is already owned by another application.',
          );
        }
      }
      const current = await tx.credentialBinding.findUnique({
        where: { id: command.id },
      });
      const data = {
        applicationId: command.applicationId,
        connectionId: command.connectionId,
        profileRef: command.profileRef,
        status: command.status,
      };
      let result;
      if (command.expectedRevision === 0) {
        if (current) {
          conflict('Binding already exists.');
        }
        result = await tx.credentialBinding.create({
          data: { id: command.id, ...data },
        });
      } else {
        if (!current) {
          notFound();
        }
        if (current.revision !== command.expectedRevision) {
          conflict('Binding revision changed.');
        }
        result = await tx.credentialBinding.update({
          where: { id: command.id },
          data: { ...data, revision: { increment: 1 } },
        });
      }
      await audited(
        command.expectedRevision === 0 ? 'binding.created' : 'binding.updated',
        result.id,
        result.revision,
        result.applicationId,
      );
      return result;
    }

    if (command.kind === 'budget') {
      if (Boolean(command.applicationId) === Boolean(command.quotaGroupRef)) {
        throw new ApplicationError(
          'INVALID_REQUEST',
          'Budget must scope exactly one application or quota group.',
        );
      }
      const current = await tx.budgetAccount.findUnique({
        where: { id: command.id },
      });
      const limitUnits = BigInt(command.limitUnits);
      if (current && limitUnits < current.heldUnits + current.postedUnits) {
        throw new ApplicationError(
          'INVALID_REQUEST',
          'Budget limit cannot fall below current exposure.',
        );
      }
      const data = {
        applicationId: command.applicationId,
        quotaGroupRef: command.quotaGroupRef,
        unit: command.unit,
        period: command.period,
        limitUnits,
      };
      let result;
      if (command.expectedRevision === 0) {
        if (current) {
          conflict('Budget already exists.');
        }
        result = await tx.budgetAccount.create({
          data: { id: command.id, ...data },
        });
      } else {
        if (!current) {
          notFound();
        }
        if (current.revision !== command.expectedRevision) {
          conflict('Budget revision changed.');
        }
        if (
          (current.unit !== command.unit ||
            current.period !== command.period ||
            current.applicationId !== command.applicationId ||
            current.quotaGroupRef !== command.quotaGroupRef) &&
          (await tx.profileRevision.count({
            where: { accountIds: { has: command.id } },
          })) > 0
        ) {
          throw new ApplicationError(
            'INVALID_REQUEST',
            'Active budget scope/unit/period is immutable.',
          );
        }
        result = await tx.budgetAccount.update({
          where: { id: command.id },
          data: { ...data, revision: { increment: 1 } },
        });
      }
      await audited(
        command.expectedRevision === 0 ? 'budget.created' : 'budget.updated',
        result.id,
        result.revision,
        result.applicationId,
      );
      return {
        ...result,
        limitUnits: asString(result.limitUnits),
        heldUnits: asString(result.heldUnits),
        postedUnits: asString(result.postedUnits),
      };
    }

    if (command.kind === 'profile') {
      const application = await tx.controlApplication.findUnique({
        where: { id: command.applicationId },
      });
      const connection = await tx.aiConnection.findUnique({
        where: { id: command.connectionId },
      });
      const alias = await tx.profileAlias.findUnique({
        where: {
          applicationId_profileRef: {
            applicationId: command.applicationId,
            profileRef: command.id,
          },
        },
      });
      if (
        !application ||
        !connection ||
        application.status !== 'ENABLED' ||
        connection.status !== 'ENABLED'
      ) {
        notFound('Enabled application/connection not found.');
      }
      const allowed = await tx.credentialBinding.findFirst({
        where: {
          applicationId: command.applicationId,
          connectionId: command.connectionId,
          status: 'ENABLED',
          OR: [{ profileRef: null }, { profileRef: command.id }],
        },
      });
      if (!allowed) {
        throw new ApplicationError(
          'POLICY_DENIED',
          'Connection is not bound to this application/profile.',
        );
      }
      if ((alias?.version ?? 0) !== command.expectedRevision) {
        conflict('Profile revision changed.');
      }
      const accounts = await tx.budgetAccount.findMany({
        where: { id: { in: command.accountIds } },
      });
      if (accounts.length !== new Set(command.accountIds).size) {
        notFound('Budget account not found.');
      }
      for (const account of accounts) {
        const validApplication =
          account.applicationId === command.applicationId;
        const validQuota =
          account.quotaGroupRef !== null &&
          account.quotaGroupRef === connection.quotaGroupRef;
        if (!validApplication && !validQuota) {
          throw new ApplicationError(
            'POLICY_DENIED',
            'Budget account is outside the application/connection scope.',
          );
        }
      }
      if (new Set(accounts.map((item) => item.unit)).size !== 1) {
        throw new ApplicationError(
          'INVALID_REQUEST',
          'Profile budget accounts must use one measurement unit.',
        );
      }
      if (
        !accounts.some(
          (item) => item.applicationId === command.applicationId,
        ) ||
        (connection.sharingMode === 'SHARED' &&
          !accounts.some(
            (item) => item.quotaGroupRef === connection.quotaGroupRef,
          ))
      ) {
        throw new ApplicationError(
          'INVALID_REQUEST',
          'Application and shared quota budgets are required.',
        );
      }
      const latest = await tx.profileRevision.findFirst({
        where: {
          applicationId: command.applicationId,
          profileRef: command.id,
        },
        orderBy: { revision: 'desc' },
      });
      const nextRevision = (latest?.revision ?? 0) + 1;
      const accountIds = [...new Set(command.accountIds)].sort();
      const providerAdapter = command.providerAdapter ?? 'UNCONFIGURED';
      const model = command.model ?? 'UNCONFIGURED';
      const fallbackConnectionId = command.fallbackConnectionId ?? null;
      const fallbackProviderAdapter = command.fallbackProviderAdapter ?? null;
      const fallbackModel = command.fallbackModel ?? null;
      const fallbackParts = [
        fallbackConnectionId,
        fallbackProviderAdapter,
        fallbackModel,
      ];
      if (
        fallbackParts.some((value) => value !== null) &&
        fallbackParts.some((value) => value === null)
      ) {
        throw new ApplicationError(
          'INVALID_REQUEST',
          'Fallback connection, provider adapter and model must be configured together.',
        );
      }
      const maxOutputTokens = command.maxOutputTokens ?? 2048;
      const timeoutMs = command.timeoutMs ?? 30000;
      const streaming = command.streaming ?? false;
      if (
        providerAdapter !== 'UNCONFIGURED' &&
        connection.provider !== providerAdapter
      ) {
        throw new ApplicationError(
          'INVALID_REQUEST',
          'Profile provider adapter must match its AI connection provider.',
        );
      }
      if (fallbackConnectionId && fallbackProviderAdapter && fallbackModel) {
        if (command.capability === 'agent_execute') {
          throw new ApplicationError(
            'INVALID_REQUEST',
            'Gateway fallback cannot be configured for agent runtime profiles.',
          );
        }
        const fallbackConnection = await tx.aiConnection.findUnique({
          where: { id: fallbackConnectionId },
        });
        if (
          !fallbackConnection ||
          fallbackConnection.status !== 'ENABLED' ||
          fallbackConnection.environment !== connection.environment
        ) {
          notFound(
            'Enabled fallback connection in the same environment not found.',
          );
        }
        if (fallbackConnection.sharingMode !== 'DEDICATED') {
          throw new ApplicationError(
            'VERSION_UNSUPPORTED',
            'M2 fallback currently requires a dedicated alternate connection.',
          );
        }
        if (fallbackConnection.provider !== fallbackProviderAdapter) {
          throw new ApplicationError(
            'INVALID_REQUEST',
            'Fallback provider adapter must match its AI connection provider.',
          );
        }
        const fallbackAllowed = await tx.credentialBinding.findFirst({
          where: {
            applicationId: command.applicationId,
            connectionId: fallbackConnectionId,
            status: 'ENABLED',
            OR: [{ profileRef: null }, { profileRef: command.id }],
          },
        });
        if (!fallbackAllowed) {
          throw new ApplicationError(
            'POLICY_DENIED',
            'Fallback connection is not bound to this application/profile.',
          );
        }
        const fallbackCredential = await tx.credentialInstance.findFirst({
          where: {
            connectionId: fallbackConnectionId,
            residency: 'CENTRAL',
            status: 'ENABLED',
            secretRef: { not: null },
          },
          select: { id: true },
        });
        if (!fallbackCredential) {
          throw new ApplicationError(
            'POLICY_DENIED',
            'Fallback connection has no enabled central credential reference.',
          );
        }
        if (
          fallbackConnectionId === command.connectionId &&
          fallbackProviderAdapter === providerAdapter &&
          fallbackModel === model
        ) {
          throw new ApplicationError(
            'INVALID_REQUEST',
            'Fallback route must differ from the primary route.',
          );
        }
      }
      const definition = {
        applicationId: command.applicationId,
        profileRef: command.id,
        revision: nextRevision,
        connectionId: command.connectionId,
        capability: command.capability,
        providerAdapter,
        model,
        fallbackConnectionId,
        fallbackProviderAdapter,
        fallbackModel,
        maxOutputTokens,
        timeoutMs,
        streaming,
        holdUnits: command.holdUnits,
        accountIds,
      };
      const created = await tx.profileRevision.create({
        data: {
          id: randomUUID(),
          applicationId: command.applicationId,
          profileRef: command.id,
          revision: nextRevision,
          connectionId: command.connectionId,
          capability: command.capability,
          providerAdapter,
          model,
          fallbackConnectionId,
          fallbackProviderAdapter,
          fallbackModel,
          maxOutputTokens,
          timeoutMs,
          streaming,
          holdUnits: BigInt(command.holdUnits),
          accountIds,
          digest: jsonDigest(definition),
        },
      });
      await tx.profileAlias.upsert({
        where: {
          applicationId_profileRef: {
            applicationId: command.applicationId,
            profileRef: command.id,
          },
        },
        create: {
          applicationId: command.applicationId,
          profileRef: command.id,
          revision: nextRevision,
          enabled: command.enabled,
        },
        update: {
          revision: nextRevision,
          enabled: command.enabled,
          version: { increment: 1 },
        },
      });
      await audited(
        'profile.published',
        command.id,
        nextRevision,
        command.applicationId,
      );
      return {
        id: created.id,
        applicationId: created.applicationId,
        profileRef: created.profileRef,
        revision: created.revision,
        connectionId: created.connectionId,
        capability: created.capability,
        providerAdapter: created.providerAdapter,
        model: created.model,
        fallbackConnectionId: created.fallbackConnectionId,
        fallbackProviderAdapter: created.fallbackProviderAdapter,
        fallbackModel: created.fallbackModel,
        maxOutputTokens: created.maxOutputTokens,
        timeoutMs: created.timeoutMs,
        streaming: created.streaming,
        holdUnits: asString(created.holdUnits),
        accountIds: created.accountIds,
        digest: created.digest,
        enabled: command.enabled,
        aliasVersion: (alias?.version ?? 0) + 1,
      };
    }

    if (command.kind === 'alias') {
      const where = {
        applicationId_profileRef: {
          applicationId: command.applicationId,
          profileRef: command.id,
        },
      };
      const current = await tx.profileAlias.findUnique({ where });
      if (!current) {
        notFound('Profile alias not found.');
      }
      if (current.version !== command.expectedRevision) {
        conflict('Alias version changed.');
      }
      const profile = await tx.profileRevision.findUnique({
        where: {
          applicationId_profileRef_revision: {
            applicationId: command.applicationId,
            profileRef: command.id,
            revision: command.revision,
          },
        },
      });
      if (!profile) {
        notFound('Profile revision not found.');
      }
      const result = await tx.profileAlias.update({
        where,
        data: {
          revision: command.revision,
          enabled: command.enabled,
          version: { increment: 1 },
        },
      });
      await audited(
        'profile.alias-updated',
        command.id,
        result.version,
        command.applicationId,
      );
      return result;
    }

    if (command.kind === 'pool') {
      const current = await tx.runnerPool.findUnique({
        where: { id: command.id },
      });
      const data = {
        environment: command.environment,
        region: command.region,
        minimumVersion: command.minimumVersion,
        status: command.status,
      };
      let result;
      if (command.expectedRevision === 0) {
        if (current) {
          conflict('Runner pool already exists.');
        }
        result = await tx.runnerPool.create({
          data: { id: command.id, ...data },
        });
      } else {
        if (!current) {
          notFound();
        }
        if (current.revision !== command.expectedRevision) {
          conflict('Runner pool revision changed.');
        }
        result = await tx.runnerPool.update({
          where: { id: command.id },
          data: { ...data, revision: { increment: 1 } },
        });
      }
      await audited(
        command.expectedRevision === 0
          ? 'runner-pool.created'
          : 'runner-pool.updated',
        result.id,
        result.revision,
      );
      return result;
    }

    const current = await tx.runnerNode.findUnique({
      where: { id: command.id },
    });
    if (!current) {
      notFound('Runner is not registered.');
    }
    if (current.revision !== command.expectedRevision) {
      conflict('Runner revision changed.');
    }
    const updated = await tx.runnerNode.update({
      where: { id: command.id },
      data: { status: command.status, revision: { increment: 1 } },
    });
    await audited('runner.lifecycle', updated.id, updated.revision);
    return presentRunner(updated);
  }

  async admit(
    principal: Principal,
    command: AdmissionCommand,
    idempotencyKey: string,
    serializationRetry = 0,
  ): Promise<AdmissionResult> {
    const applicationId = requireApplication(principal);
    const requestDigest = digest(
      `${command.profileRef}\0${command.inputDigest}`,
    );
    const existing = await this.database.execution.findUnique({
      where: {
        applicationId_idempotencyKey: { applicationId, idempotencyKey },
      },
    });
    if (existing) {
      if (existing.requestDigest !== requestDigest) {
        conflict('Idempotency key belongs to a different request.');
      }
      return {
        execution: await this.admissionView(existing.id, applicationId),
        replayed: true,
      };
    }

    const executionId = randomUUID();
    try {
      await this.database.$transaction(
        async (tx) => {
          const application = await tx.controlApplication.findUnique({
            where: { id: applicationId },
          });
          if (application?.status !== 'ENABLED') {
            throw new ApplicationError(
              'POLICY_DENIED',
              'Application is not enabled.',
            );
          }
          const alias = await tx.profileAlias.findUnique({
            where: {
              applicationId_profileRef: {
                applicationId,
                profileRef: command.profileRef,
              },
            },
          });
          if (!alias?.enabled) {
            notFound('Published profile not found.');
          }
          const profile = await tx.profileRevision.findUnique({
            where: {
              applicationId_profileRef_revision: {
                applicationId,
                profileRef: command.profileRef,
                revision: alias.revision,
              },
            },
          });
          if (!profile) {
            notFound('Published profile revision not found.');
          }
          const connection = await tx.aiConnection.findUnique({
            where: { id: profile.connectionId },
          });
          if (!connection || connection.status !== 'ENABLED') {
            throw new ApplicationError(
              'POLICY_DENIED',
              'Profile connection is not enabled.',
            );
          }
          const binding = await tx.credentialBinding.findFirst({
            where: {
              applicationId,
              connectionId: profile.connectionId,
              status: 'ENABLED',
              OR: [{ profileRef: null }, { profileRef: profile.profileRef }],
            },
          });
          if (!binding) {
            throw new ApplicationError(
              'POLICY_DENIED',
              'Connection is not bound to this application/profile.',
            );
          }

          const routeScope =
            connection.sharingMode === 'SHARED'
              ? 'quota:' + connection.quotaGroupRef
              : 'connection:' + connection.id;
          const admissionScopes = [
            'application:' + applicationId,
            routeScope,
          ].sort();
          for (const scope of admissionScopes) {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${scope}, 0))`;
          }
          const [applicationActive] = await tx.$queryRaw<
            Array<{ count: bigint }>
          >`SELECT count(*)::bigint AS count
              FROM control.executions
              WHERE application_id = ${applicationId}
                AND status IN ('ACCEPTED','RUNNING','RECONCILING')`;
          if (
            (applicationActive?.count ?? 0n) >=
            BigInt(application.gatewayMaxConcurrency)
          ) {
            throw new ApplicationError(
              'RESOURCE_EXHAUSTED',
              'Application gateway concurrency exhausted.',
            );
          }
          const routeRows =
            connection.sharingMode === 'SHARED'
              ? await tx.$queryRaw<
                  Array<{ count: bigint }>
                >`SELECT count(*)::bigint AS count
                     FROM control.executions e
                     JOIN control.profile_revisions p ON p.id = e.profile_revision_id
                     JOIN control.ai_connections c ON c.id = p.connection_id
                     WHERE e.status IN ('ACCEPTED','RUNNING','RECONCILING')
                       AND c.quota_group_ref = ${connection.quotaGroupRef}`
              : await tx.$queryRaw<
                  Array<{ count: bigint }>
                >`SELECT count(*)::bigint AS count
                     FROM control.executions e
                     JOIN control.profile_revisions p ON p.id = e.profile_revision_id
                     WHERE e.status IN ('ACCEPTED','RUNNING','RECONCILING')
                       AND p.connection_id = ${connection.id}`;
          if (
            (routeRows[0]?.count ?? 0n) >=
            BigInt(connection.gatewayMaxConcurrency)
          ) {
            throw new ApplicationError(
              'RESOURCE_EXHAUSTED',
              'AI connection gateway concurrency exhausted.',
            );
          }
          const consumeRate = async (scope: string, limit: number) => {
            const rows = await tx.$queryRaw<
              Array<{ request_count: number }>
            >`INSERT INTO control.admission_rate_windows(scope_key, window_start, request_count)
               VALUES (${scope}, date_trunc('minute', clock_timestamp()), 1)
               ON CONFLICT(scope_key, window_start) DO UPDATE
                 SET request_count = control.admission_rate_windows.request_count + 1
                 WHERE control.admission_rate_windows.request_count < ${limit}
               RETURNING request_count`;
            if (!rows.length) {
              throw new ApplicationError(
                'RESOURCE_EXHAUSTED',
                'Gateway admission rate limit exceeded.',
              );
            }
          };
          await consumeRate(
            'application:' + applicationId,
            application.gatewayRequestsPerMinute,
          );
          await consumeRate(routeScope, connection.gatewayRequestsPerMinute);

          const sortedAccounts = [...profile.accountIds].sort();
          const locked: Array<{
            id: string;
            application_id: string | null;
            quota_group_ref: string | null;
            limit_units: bigint;
            held_units: bigint;
            posted_units: bigint;
            revision: number;
          }> = [];
          for (const accountId of sortedAccounts) {
            const rows = await tx.$queryRaw<
              Array<{
                id: string;
                application_id: string | null;
                quota_group_ref: string | null;
                limit_units: bigint;
                held_units: bigint;
                posted_units: bigint;
                revision: number;
              }>
            >`SELECT id, application_id, quota_group_ref, limit_units, held_units, posted_units, revision
                FROM control.budget_accounts WHERE id = ${accountId} FOR UPDATE`;
            const account = rows[0];
            if (!account) {
              notFound('Budget account not found.');
            }
            const scoped =
              account.application_id === applicationId ||
              (account.quota_group_ref !== null &&
                account.quota_group_ref === connection.quotaGroupRef);
            if (!scoped) {
              throw new ApplicationError(
                'POLICY_DENIED',
                'Budget account is out of scope.',
              );
            }
            if (
              account.limit_units - account.held_units - account.posted_units <
              profile.holdUnits
            ) {
              throw new ApplicationError(
                'RESOURCE_EXHAUSTED',
                'Budget exhausted.',
              );
            }
            locked.push(account);
          }

          const snapshot = {
            ref: profile.profileRef,
            revision: profile.revision,
            capability: profile.capability,
            connectionId: profile.connectionId,
            quotaGroupRef: connection.quotaGroupRef,
            providerAdapter: profile.providerAdapter,
            model: profile.model,
            fallbackConnectionId: profile.fallbackConnectionId,
            fallbackProviderAdapter: profile.fallbackProviderAdapter,
            fallbackModel: profile.fallbackModel,
            maxOutputTokens: profile.maxOutputTokens,
            timeoutMs: profile.timeoutMs,
            streaming: profile.streaming,
            holdUnits: asString(profile.holdUnits),
            accountIds: sortedAccounts,
            profileDigest: profile.digest,
          };
          await tx.execution.create({
            data: {
              id: executionId,
              applicationId,
              idempotencyKey,
              requestDigest,
              profileRevisionId: profile.id,
              profileSnapshot: snapshot,
            },
          });
          await tx.attempt.create({
            data: { id: randomUUID(), executionId, number: 1 },
          });
          for (const account of locked) {
            await tx.budgetAccount.update({
              where: { id: account.id },
              data: {
                heldUnits: { increment: profile.holdUnits },
                revision: { increment: 1 },
              },
            });
            await tx.outboxEvent.create({
              data: {
                id: randomUUID(),
                applicationId,
                topic: 'budget.updated',
                aggregateId: account.id,
                revision: account.revision + 1,
                payload: {
                  account_id: account.id,
                  revision: account.revision + 1,
                  held_units: asString(account.held_units + profile.holdUnits),
                  posted_units: asString(account.posted_units),
                },
              },
            });
            await tx.reservation.create({
              data: {
                executionId,
                accountId: account.id,
                originalUnits: profile.holdUnits,
                heldUnits: profile.holdUnits,
              },
            });
          }
          await tx.outboxEvent.create({
            data: {
              id: randomUUID(),
              applicationId,
              topic: 'execution.admitted',
              aggregateId: executionId,
              revision: 1,
              payload: {
                execution_id: executionId,
                application_id: applicationId,
                profile_ref: profile.profileRef,
                profile_revision: profile.revision,
              },
            },
          });
        },
        { isolationLevel: 'Serializable' },
      );
      return {
        execution: await this.admissionView(executionId, applicationId),
        replayed: false,
      };
    } catch (error) {
      if (retryableTransactionError(error) && serializationRetry < 64) {
        await transactionBackoff(serializationRetry);
        return this.admit(
          principal,
          command,
          idempotencyKey,
          serializationRetry + 1,
        );
      }
      if (isPrismaCode(error, 'P2002')) {
        const raced = await this.database.execution.findUnique({
          where: {
            applicationId_idempotencyKey: { applicationId, idempotencyKey },
          },
        });
        if (raced) {
          if (raced.requestDigest !== requestDigest) {
            conflict('Idempotency key belongs to a different request.');
          }
          return {
            execution: await this.admissionView(raced.id, applicationId),
            replayed: true,
          };
        }
      }
      throw error;
    }
  }

  private async admissionView(id: string, applicationId: string) {
    const execution = await this.database.execution.findFirst({
      where: { id, applicationId },
    });
    if (!execution) {
      notFound();
    }
    const snapshot = execution.profileSnapshot as {
      ref?: unknown;
      revision?: unknown;
    };
    return {
      id: execution.id,
      applicationId: execution.applicationId,
      status: execution.status,
      revision: execution.revision,
      profileRef: String(snapshot.ref ?? ''),
      profileRevision: Number(snapshot.revision ?? 0),
      createdAt: execution.createdAt.toISOString(),
    };
  }

  async readExecution(
    principal: Principal,
    executionId: string,
  ): Promise<ExecutionView> {
    const applicationId = requireApplication(principal);
    const execution = await this.database.execution.findFirst({
      where: { id: executionId, applicationId },
      include: {
        reservations: true,
        attempts: true,
        artifacts: true,
        observations: true,
      },
    });
    if (!execution) {
      notFound();
    }
    return {
      ...this.executionView(execution),
      attempts: execution.attempts,
      artifacts: execution.artifacts.map((item) => ({
        ...item,
        sizeBytes: asString(item.sizeBytes),
      })),
      observations: execution.observations.map((item) => ({
        ...item,
        cumulativeUnits:
          item.cumulativeUnits === null ? null : asString(item.cumulativeUnits),
        createdAt: item.createdAt.toISOString(),
      })),
    };
  }

  async cancelExecution(
    principal: Principal,
    executionId: string,
    reason: string | null,
  ): Promise<ExecutionView> {
    const applicationId = requireApplication(principal);
    await this.transaction(async (tx) => {
      const current = await tx.execution.findFirst({
        where: { id: executionId, applicationId },
      });
      if (!current) {
        notFound();
      }
      if (!current.cancelRequestedAt) {
        const revision = current.revision + 1;
        await tx.execution.update({
          where: { id: executionId },
          data: { cancelRequestedAt: new Date(), revision },
        });
        await tx.outboxEvent.create({
          data: {
            id: randomUUID(),
            applicationId,
            topic: 'execution.cancel-requested',
            aggregateId: executionId,
            revision,
            payload: { execution_id: executionId, reason },
          },
        });
      }
    });
    return this.readExecution(principal, executionId);
  }

  private executionView(execution: {
    id: string;
    applicationId: string;
    status: string;
    revision: number;
    cancelRequestedAt: Date | null;
    profileSnapshot: Prisma.JsonValue;
    reservations: Array<{
      accountId: string;
      originalUnits: bigint;
      heldUnits: bigint;
      postedUnits: bigint;
      state: string;
    }>;
  }): Omit<ExecutionView, 'attempts' | 'artifacts' | 'observations'> {
    const snapshot = execution.profileSnapshot as {
      ref?: unknown;
      revision?: unknown;
      capability?: unknown;
    };
    return {
      id: execution.id,
      applicationId: execution.applicationId,
      status: execution.status,
      revision: execution.revision,
      cancelRequestedAt: execution.cancelRequestedAt?.toISOString() ?? null,
      profile: {
        ref: String(snapshot.ref ?? ''),
        revision: Number(snapshot.revision ?? 0),
        capability: String(snapshot.capability ?? ''),
      },
      accounting: {
        reservations: execution.reservations.map((item) => ({
          accountId: item.accountId,
          originalUnits: asString(item.originalUnits),
          heldUnits: asString(item.heldUnits),
          postedUnits: asString(item.postedUnits),
          state: item.state,
        })),
      },
    };
  }

  async recordUsage(
    principal: Principal,
    command: UsageCommand,
  ): Promise<UsageResult> {
    const normalized = { ...command, coverage: [...command.coverage].sort() };
    const bodyDigest = jsonDigest(normalized);
    return this.transaction(async (tx) => {
      // Serialize evidence for one execution before locking its accounts in ID order.
      await tx.$queryRaw`SELECT id FROM control.executions WHERE id = ${command.executionId}::uuid FOR UPDATE`;
      const execution = await tx.execution.findUnique({
        where: { id: command.executionId },
        include: { reservations: true },
      });
      if (!execution) {
        notFound('Execution not found.');
      }
      const existing = await tx.usageObservation.findUnique({
        where: {
          executionId_sourceEventId_sourceRevision: {
            executionId: command.executionId,
            sourceEventId: command.sourceEventId,
            sourceRevision: command.sourceRevision,
          },
        },
      });
      const accountViews = async () => {
        const accounts = await tx.budgetAccount.findMany({
          where: {
            id: { in: execution.reservations.map((item) => item.accountId) },
          },
          orderBy: { id: 'asc' },
        });
        return accounts.map((item) => ({
          accountId: item.id,
          heldUnits: asString(item.heldUnits),
          postedUnits: asString(item.postedUnits),
          revision: item.revision,
        }));
      };
      if (existing) {
        if (existing.digest !== bodyDigest) {
          conflict('Usage revision conflicts with previously stored evidence.');
        }
        return {
          observationId: existing.id,
          replayed: true,
          postedDelta: existing.cumulativeUnits === null ? null : '0',
          completeness: existing.completeness,
          accounts: await accountViews(),
        };
      }
      const attempt = await tx.attempt.findFirst({
        where: { id: command.attemptId, executionId: command.executionId },
      });
      if (!attempt) {
        notFound('Attempt not found.');
      }
      const history = await tx.usageObservation.findMany({
        where: { executionId: command.executionId },
        orderBy: { sourceRevision: 'desc' },
      });
      const prior = history.find(
        (item) => item.sourceEventId === command.sourceEventId,
      );
      if (
        prior &&
        (prior.sourceRevision >= command.sourceRevision ||
          prior.attemptId !== command.attemptId ||
          canonicalJson(prior.coverage) !== canonicalJson(normalized.coverage))
      ) {
        conflict('Usage source revision, attribution or coverage changed.');
      }
      if (
        history.some(
          (item) =>
            item.sourceEventId !== command.sourceEventId &&
            item.coverage.some((part) => command.coverage.includes(part)),
        )
      ) {
        conflict(
          'Usage coverage overlaps another economic source. Correct the original source instead.',
        );
      }
      const cumulative =
        command.cumulativeUnits === null
          ? null
          : BigInt(command.cumulativeUnits);
      const previousKnown = history.find(
        (item) =>
          item.sourceEventId === command.sourceEventId &&
          item.cumulativeUnits !== null,
      );
      const delta =
        cumulative === null
          ? null
          : cumulative - (previousKnown?.cumulativeUnits ?? 0n);
      const observationId = randomUUID();
      await tx.usageObservation.create({
        data: {
          ...normalized,
          id: observationId,
          digest: bodyDigest,
          cumulativeUnits: cumulative,
          verification: cumulative === null ? 'PENDING' : 'VERIFIED',
        },
      });
      await tx.auditEntry.create({
        data: {
          id: randomUUID(),
          applicationId: execution.applicationId,
          actor: principal.subject,
          action: 'usage.observed',
          resourceId: observationId,
          revision: command.sourceRevision,
        },
      });
      const latest = new Map<string, (typeof history)[number]>();
      for (const item of history) {
        if (!latest.has(item.sourceEventId)) {
          latest.set(item.sourceEventId, item);
        }
      }
      latest.delete(command.sourceEventId);
      // In P1 the accountant attests complete coverage; runtime closure is not inferred.
      const complete =
        command.completeness === 'complete' &&
        [...latest.values()].every(
          (item) =>
            item.completeness === 'complete' && item.cumulativeUnits !== null,
        );
      for (const accountId of execution.reservations
        .map((item) => item.accountId)
        .sort()) {
        const reservation = execution.reservations.find(
          (item) => item.accountId === accountId,
        )!;
        await tx.$queryRaw`SELECT id FROM control.budget_accounts WHERE id = ${accountId} FOR UPDATE`;
        const account = await tx.budgetAccount.findUniqueOrThrow({
          where: { id: accountId },
        });
        const nextPosted = reservation.postedUnits + (delta ?? 0n);
        const nextHeld =
          delta === null
            ? reservation.heldUnits
            : complete
              ? 0n
              : positive(reservation.originalUnits - nextPosted);
        if (nextPosted < 0n) {
          throw new ApplicationError(
            'INVALID_REQUEST',
            'Correction exceeds the recorded charge.',
          );
        }
        const updated = await tx.budgetAccount.update({
          where: { id: accountId },
          data: {
            postedUnits: { increment: delta ?? 0n },
            heldUnits: { increment: nextHeld - reservation.heldUnits },
            revision: { increment: 1 },
          },
        });
        await tx.reservation.update({
          where: {
            executionId_accountId: { executionId: execution.id, accountId },
          },
          data: {
            postedUnits: nextPosted,
            heldUnits: nextHeld,
            revision: { increment: 1 },
            state: complete
              ? nextPosted > reservation.originalUnits
                ? 'OVERAGE_SETTLED'
                : 'SETTLED'
              : 'PENDING_RECONCILIATION',
          },
        });
        if (delta !== null) {
          const previousEntry = await tx.ledgerEntry.findFirst({
            where: { executionId: execution.id, accountId },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          });
          await tx.ledgerEntry.create({
            data: {
              id: randomUUID(),
              executionId: execution.id,
              accountId,
              observationId,
              commandId: jsonDigest([
                execution.id,
                command.sourceEventId,
                command.sourceRevision,
              ]),
              deltaUnits: delta,
              previousEntryId: previousEntry?.id ?? null,
            },
          });
        }
        await tx.outboxEvent.create({
          data: {
            id: randomUUID(),
            applicationId: execution.applicationId,
            topic: 'budget.updated',
            aggregateId: accountId,
            revision: updated.revision,
            payload: {
              account_id: accountId,
              revision: updated.revision,
              held_units: asString(updated.heldUnits),
              posted_units: asString(updated.postedUnits),
            },
          },
        });
        // Reading the row inside this transaction also detects aggregate inconsistencies.
        if (account.postedUnits + (delta ?? 0n) < 0n) {
          conflict('Account aggregate is inconsistent.');
        }
      }
      return {
        observationId,
        replayed: false,
        postedDelta: delta === null ? null : asString(delta),
        completeness: command.completeness,
        accounts: await accountViews(),
      };
    });
  }

  async registerArtifact(principal: Principal, command: ArtifactCommand) {
    const applicationId = requireApplication(principal);
    const execution = await this.database.execution.findFirst({
      where: { id: command.executionId, applicationId },
    });
    if (!execution) {
      notFound('Execution not found.');
    }
    try {
      const created = await this.database.artifactMetadata.create({
        data: {
          id: command.id,
          executionId: command.executionId,
          name: command.name,
          digest: command.digest,
          sizeBytes: BigInt(command.sizeBytes),
          mediaType: command.mediaType,
        },
      });
      return {
        id: created.id,
        executionId: created.executionId,
        name: created.name,
        digest: created.digest,
        sizeBytes: asString(created.sizeBytes),
        mediaType: created.mediaType,
        status: created.status,
      };
    } catch (error) {
      if (!isPrismaCode(error, 'P2002')) {
        throw error;
      }
      const existing = await this.database.artifactMetadata.findUnique({
        where: { id: command.id },
      });
      if (
        !existing ||
        existing.executionId !== command.executionId ||
        existing.digest !== command.digest ||
        existing.sizeBytes !== BigInt(command.sizeBytes) ||
        existing.name !== command.name ||
        existing.mediaType !== command.mediaType
      ) {
        conflict('Artifact id belongs to different metadata.');
      }
      return {
        id: existing.id,
        executionId: existing.executionId,
        name: existing.name,
        digest: existing.digest,
        sizeBytes: asString(existing.sizeBytes),
        mediaType: existing.mediaType,
        status: existing.status,
        replayed: true,
      };
    }
  }

  async registerRunner(principal: Principal, command: RunnerRegistration) {
    if (principal.kind !== 'runner') {
      throw new ApplicationError('POLICY_DENIED', 'Runner principal required.');
    }
    return this.transaction(async (tx) => {
      const pool = await tx.runnerPool.findUnique({
        where: { id: command.poolId },
      });
      if (!pool || pool.status !== 'ENABLED') {
        throw new ApplicationError(
          'POLICY_DENIED',
          'Runner pool is not enabled.',
        );
      }
      const version = command.version.split('.').map(Number);
      const minimum = pool.minimumVersion.split('.').map(Number);
      const difference =
        version
          .map((part, index) => part - minimum[index]!)
          .find((part) => part !== 0) ?? 0;
      if (difference < 0) {
        throw new ApplicationError(
          'POLICY_DENIED',
          'Runner version is below pool minimum.',
        );
      }
      const connectionCount = await tx.aiConnection.count({
        where: {
          id: { in: command.connectionIds },
          status: 'ENABLED',
          environment: pool.environment,
        },
      });
      if (connectionCount !== new Set(command.connectionIds).size) {
        throw new ApplicationError(
          'POLICY_DENIED',
          'Runner advertised unavailable connection.',
        );
      }
      const existing = await tx.runnerNode.findUnique({
        where: { id: command.id },
      });
      if (existing && existing.ownerSubject !== principal.subject) {
        throw new ApplicationError(
          'POLICY_DENIED',
          'Runner identity takeover denied.',
        );
      }
      const data = {
        ownerSubject: principal.subject,
        poolId: command.poolId,
        version: command.version,
        capabilities: command.capabilities,
        connectionIds: [...new Set(command.connectionIds)].sort(),
        capacity: command.capacity,
        status: existing?.status ?? 'RUNNING',
        lastHeartbeatAt: new Date(),
      };
      const runner = existing
        ? await tx.runnerNode.update({
            where: { id: command.id },
            data: { ...data, revision: { increment: 1 } },
          })
        : await tx.runnerNode.create({ data: { id: command.id, ...data } });
      await tx.auditEntry.create({
        data: {
          id: randomUUID(),
          actor: principal.subject,
          action: existing ? 'runner.reregistered' : 'runner.registered',
          resourceId: runner.id,
          revision: runner.revision,
        },
      });
      return presentRunner(runner);
    });
  }

  async readOutbox() {
    return (
      await this.database.outboxEvent.findMany({
        where: { deliveredAt: null },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: 200,
      })
    ).map(presentOutbox);
  }

  async recordInbox(_principal: Principal, consumer: string, eventId: string) {
    return this.transaction(async (tx) => {
      const existing = await tx.inboxReceipt.findUnique({
        where: { consumer_eventId: { consumer, eventId } },
      });
      if (existing) {
        return { replayed: true };
      }
      const event = await tx.outboxEvent.findUnique({ where: { id: eventId } });
      if (!event) {
        notFound('Outbox event not found.');
      }
      if (consumer === 'budget-projection') {
        if (event.topic !== 'budget.updated') {
          throw new ApplicationError('INVALID_REQUEST', 'Not a budget event.');
        }
        const current = await tx.budgetProjection.findUnique({
          where: { accountId: event.aggregateId },
        });
        if (!current || current.revision < event.revision) {
          await tx.budgetProjection.upsert({
            where: { accountId: event.aggregateId },
            create: {
              accountId: event.aggregateId,
              revision: event.revision,
              snapshot: event.payload as Prisma.InputJsonValue,
            },
            update: {
              revision: event.revision,
              snapshot: event.payload as Prisma.InputJsonValue,
            },
          });
        }
      } else if (
        consumer !== 'control-foundation' ||
        event.topic === 'budget.updated'
      ) {
        throw new ApplicationError(
          'INVALID_REQUEST',
          'Unsupported foundation consumer.',
        );
      }
      await tx.inboxReceipt.create({ data: { consumer, eventId } });
      await tx.outboxEvent.update({
        where: { id: eventId },
        data: { deliveredAt: new Date() },
      });
      return { replayed: false };
    });
  }

  async readAudit(_principal: Principal, applicationId?: string) {
    return (
      await this.database.auditEntry.findMany({
        where: applicationId ? { applicationId } : undefined,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 200,
      })
    ).map(presentAudit);
  }
}
