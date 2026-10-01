import { randomUUID } from 'node:crypto';
import {
  RunnerDispatchGrant,
  type Assignment,
} from '@ai-runtime/contracts/http';
import type {
  Prisma,
  RunnerAssignment,
} from '../../../infrastructure/database/generated/client.js';
import type { DatabaseService } from '../../../infrastructure/database/database.service.js';
import type { RunnerDispatchRepository } from '../application/runner-dispatch.port.js';
import type { RunnerRegistrationIdentity } from '../application/runner-liveness-registry.port.js';
import { ApplicationError } from '../../../shared/domain/application-error.js';

const ACTIVE_ASSIGNMENT_STATES = [
  'GRANTED',
  'STARTED',
  'RESULT_PROPOSED',
] as const;

function assignment(row: RunnerAssignment): Assignment {
  return {
    assignmentId: row.id,
    executionId: row.executionId,
    attemptId: row.attemptId,
    runnerId: row.runnerId,
    ownerSubject: row.ownerSubject,
    generation: row.generation,
    epoch: row.epoch,
    state: row.state as Assignment['state'],
    protocolVersion: '1',
  };
}

function compareVersion(left: string, right: string) {
  const a = left.split('.').map(Number);
  const b = right.split('.').map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}

interface LockedDispatch {
  executionId: string;
  attemptId: string;
  applicationId: string;
  envelopeId: string;
  inputDigest: string;
  plaintextBytes: number;
  expiresAt: Date;
  executionRevision: number;
  coordinationEpoch: number;
  plugin: RunnerDispatchGrant['plugin'];
}

export class PrismaRunnerDispatchRepository implements RunnerDispatchRepository {
  constructor(
    private readonly db: DatabaseService,
    private readonly strictCoordination = false,
  ) {}

  private async lockAndValidate(
    tx: Prisma.TransactionClient,
    executionId: string,
    registration: RunnerRegistrationIdentity,
    bootId: string,
    existingAssignmentId?: string,
    coordinationEpoch?: number,
  ): Promise<LockedDispatch | null> {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM control.executions
      WHERE id = ${executionId}::uuid
      FOR UPDATE SKIP LOCKED`;
    if (locked.length === 0) {
      return null;
    }

    const execution = await tx.execution.findUnique({
      where: { id: executionId },
      include: {
        application: true,
        profile: true,
        dispatchEnvelope: true,
        attempts: {
          where: { status: 'PREPARED', authority: 'UNASSIGNED' },
          orderBy: { number: 'asc' },
          take: 1,
        },
      },
    });
    if (
      !execution ||
      execution.admissionSource !== 'AGENT' ||
      execution.status !== 'ACCEPTED' ||
      execution.cancelRequestedAt ||
      execution.profile.capability !== 'agent_execute' ||
      !execution.dispatchEnvelope ||
      execution.dispatchEnvelope.state !== 'COMMITTED' ||
      execution.dispatchEnvelope.executionId !== execution.id
    ) {
      return null;
    }
    if (
      coordinationEpoch !== undefined &&
      existingAssignmentId &&
      execution.coordinationEpoch !== coordinationEpoch
    ) {
      return null;
    }

    const envelopeCurrent = await tx.$queryRaw<
      Array<{
        id: string;
        inputDigest: string;
        plaintextBytes: bigint;
        expiresAt: Date;
      }>
    >`
      SELECT id,
             input_digest AS "inputDigest",
             plaintext_bytes AS "plaintextBytes",
             expires_at AS "expiresAt"
      FROM control.dispatch_envelopes
      WHERE id = ${execution.dispatchEnvelope.id}::uuid
        AND state = 'COMMITTED'::control."DispatchEnvelopeState"
        AND expires_at > clock_timestamp()
      FOR SHARE`;
    if (envelopeCurrent.length === 0) {
      return null;
    }
    const envelope = envelopeCurrent[0]!;

    await tx.$queryRaw`SELECT id FROM control.applications WHERE id = ${execution.applicationId} FOR SHARE`;
    await tx.$queryRaw`SELECT id FROM control.ai_connections WHERE id = ${execution.profile.connectionId} FOR SHARE`;
    await tx.$queryRaw`SELECT id FROM control.runner_nodes WHERE id = ${registration.runnerId} FOR UPDATE`;
    const application = await tx.controlApplication.findUnique({
      where: { id: execution.applicationId },
    });
    const runner = await tx.runnerNode.findUnique({
      where: { id: registration.runnerId },
    });
    if (runner) {
      await tx.$queryRaw`SELECT id FROM control.runner_pools WHERE id = ${runner.poolId} FOR SHARE`;
    }
    const pool = runner
      ? await tx.runnerPool.findUnique({ where: { id: runner.poolId } })
      : null;
    if (
      !application ||
      application.status !== 'ENABLED' ||
      !runner ||
      runner.ownerSubject !== registration.ownerSubject ||
      runner.revision !== registration.registrationRevision ||
      runner.status !== 'RUNNING' ||
      !pool ||
      pool.status !== 'ENABLED' ||
      pool.environment !== application.environment ||
      compareVersion(runner.version, pool.minimumVersion) < 0 ||
      !runner.capabilities.includes('agent_execute') ||
      !runner.connectionIds.includes(execution.profile.connectionId)
    ) {
      return null;
    }

    const connection = await tx.aiConnection.findUnique({
      where: { id: execution.profile.connectionId },
    });
    if (
      !connection ||
      connection.status !== 'ENABLED' ||
      connection.environment !== application.environment
    ) {
      return null;
    }
    const bindings = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM control.credential_bindings
      WHERE application_id = ${execution.applicationId}
        AND connection_id = ${connection.id}
        AND status = 'ENABLED'
        AND (profile_ref IS NULL OR profile_ref = ${execution.profile.profileRef})
      ORDER BY id LIMIT 1 FOR SHARE`;
    if (bindings.length === 0) {
      return null;
    }
    let plugin: RunnerDispatchGrant['plugin'] = null;
    if (execution.profile.pluginPackageId) {
      const pinned = execution.profile;
      const [packageState] = await tx.$queryRaw<
        Array<{
          bundle_digest: string;
          required_permissions: string[];
          state: string;
        }>
      >`SELECT bundle_digest, required_permissions, state
          FROM control.plugin_packages
          WHERE application_id = ${execution.applicationId}
            AND package_id = ${pinned.pluginPackageId}
            AND version = ${pinned.pluginVersion}
          FOR SHARE`;
      if (
        !packageState ||
        packageState.state !== 'ACTIVE' ||
        packageState.bundle_digest.trim() !== pinned.pluginDigest?.trim()
      ) {
        return null;
      }
      if (
        !pinned.pluginPackageId ||
        !pinned.pluginVersion ||
        !pinned.pluginDigest ||
        !pinned.pluginRuntimeVersion
      ) {
        return null;
      }
      plugin = {
        packageId: pinned.pluginPackageId,
        version: pinned.pluginVersion,
        bundleDigest: pinned.pluginDigest.trim(),
        runtimeVersion: pinned.pluginRuntimeVersion,
        requiredPermissions: packageState.required_permissions,
      };
    }
    const credentials = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM control.credential_instances
      WHERE connection_id = ${connection.id}
        AND status = 'ENABLED'
        AND (
          (residency = 'CENTRAL' AND runner_ref IS NULL)
          OR
          (residency = 'RUNNER_LOCAL' AND runner_ref = ${runner.id})
        )
      ORDER BY residency DESC, id LIMIT 1 FOR SHARE`;
    if (credentials.length === 0) {
      return null;
    }

    if (existingAssignmentId) {
      const current = await tx.runnerAssignment.findUnique({
        where: { id: existingAssignmentId },
      });
      if (
        !current ||
        current.runnerId !== runner.id ||
        current.ownerSubject !== runner.ownerSubject ||
        current.claimBootId !== bootId ||
        current.executionId !== execution.id ||
        current.generation !== execution.assignmentGeneration ||
        current.epoch !== execution.coordinationEpoch ||
        current.state !== 'GRANTED'
      ) {
        return null;
      }
      return {
        executionId: execution.id,
        attemptId: current.attemptId,
        applicationId: execution.applicationId,
        envelopeId: envelope.id,
        inputDigest: envelope.inputDigest,
        plaintextBytes: Number(envelope.plaintextBytes),
        expiresAt: envelope.expiresAt,
        executionRevision: execution.revision,
        coordinationEpoch: coordinationEpoch ?? execution.coordinationEpoch,
        plugin,
      };
    }

    if (execution.assignmentGeneration !== 0) {
      return null;
    }
    const attempt = execution.attempts[0];
    if (!attempt) {
      return null;
    }
    const active = await tx.runnerAssignment.count({
      where: {
        runnerId: runner.id,
        state: { in: [...ACTIVE_ASSIGNMENT_STATES] },
      },
    });
    if (active >= runner.capacity) {
      return null;
    }
    return {
      executionId: execution.id,
      attemptId: attempt.id,
      applicationId: execution.applicationId,
      envelopeId: envelope.id,
      inputDigest: envelope.inputDigest,
      plaintextBytes: Number(envelope.plaintextBytes),
      expiresAt: envelope.expiresAt,
      executionRevision: execution.revision,
      coordinationEpoch: coordinationEpoch ?? execution.coordinationEpoch,
      plugin,
    };
  }

  private async grant(
    tx: Prisma.TransactionClient,
    dispatch: LockedDispatch,
    registration: RunnerRegistrationIdentity,
    bootId: string,
  ): Promise<RunnerAssignment> {
    const id = randomUUID();
    const generation = 1;
    await tx.execution.update({
      where: { id: dispatch.executionId },
      data: {
        assignmentGeneration: generation,
        coordinationEpoch: dispatch.coordinationEpoch,
        revision: { increment: 1 },
      },
    });
    const created = await tx.runnerAssignment.create({
      data: {
        id,
        executionId: dispatch.executionId,
        attemptId: dispatch.attemptId,
        runnerId: registration.runnerId,
        ownerSubject: registration.ownerSubject,
        claimBootId: bootId,
        generation,
        epoch: dispatch.coordinationEpoch,
        state: 'GRANTED',
        protocolVersion: '1',
      },
    });
    await tx.attempt.update({
      where: { id: dispatch.attemptId },
      data: { generation, authority: 'OWNED' },
    });
    await tx.auditEntry.create({
      data: {
        id: randomUUID(),
        applicationId: dispatch.applicationId,
        actor: 'system:runner-dispatcher',
        action: 'runner.assignment-auto-granted',
        resourceId: dispatch.executionId,
        revision: dispatch.executionRevision + 1,
      },
    });
    await tx.outboxEvent.create({
      data: {
        id: randomUUID(),
        applicationId: dispatch.applicationId,
        topic: 'runner.assignment-granted',
        aggregateId: id,
        revision: generation,
        payload: {
          assignment_id: id,
          execution_id: dispatch.executionId,
          runner_id: registration.runnerId,
          generation,
          epoch: dispatch.coordinationEpoch,
          dispatch_envelope_id: dispatch.envelopeId,
        },
      },
    });
    return created;
  }

  async claim(
    registration: RunnerRegistrationIdentity,
    bootId: string,
  ): Promise<RunnerDispatchGrant | null> {
    return this.db.$transaction(
      async (tx) => {
        let coordinationEpoch: number | undefined;
        if (this.strictCoordination) {
          const rows = await tx.$queryRaw<
            Array<{ epoch: number; state: string }>
          >`SELECT epoch, state FROM control.runner_coordination WHERE id = 1 FOR SHARE`;
          if (rows[0]?.state !== 'ACTIVE') {
            throw new ApplicationError(
              'DEPENDENCY_UNAVAILABLE',
              'Runner coordination is paused.',
            );
          }
          coordinationEpoch = rows[0].epoch;
        }
        const registered = await tx.runnerNode.findUnique({
          where: { id: registration.runnerId },
          include: { pool: true },
        });
        if (
          !registered ||
          registered.ownerSubject !== registration.ownerSubject ||
          registered.revision !== registration.registrationRevision ||
          registered.connectionIds.length === 0
        ) {
          return null;
        }

        const existing = await tx.runnerAssignment.findFirst({
          where: {
            runnerId: registration.runnerId,
            ownerSubject: registration.ownerSubject,
            state: 'GRANTED',
            execution: { admissionSource: 'AGENT' },
          },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        });
        if (existing) {
          const dispatch = await this.lockAndValidate(
            tx,
            existing.executionId,
            registration,
            bootId,
            existing.id,
            coordinationEpoch,
          );
          return dispatch
            ? RunnerDispatchGrant.parse({
                ...assignment(existing),
                envelopeId: dispatch.envelopeId,
                inputDigest: dispatch.inputDigest,
                plaintextBytes: dispatch.plaintextBytes,
                expiresAt: dispatch.expiresAt.toISOString(),
                plugin: dispatch.plugin,
              })
            : null;
        }

        const candidates = await tx.execution.findMany({
          where: {
            admissionSource: 'AGENT',
            status: 'ACCEPTED',
            assignmentGeneration: 0,
            cancelRequestedAt: null,
            application: {
              status: 'ENABLED',
              environment: registered.pool.environment,
            },
            profile: {
              capability: 'agent_execute',
              connectionId: { in: registered.connectionIds },
            },
            dispatchEnvelope: { is: { state: 'COMMITTED' } },
          },
          select: { id: true },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          take: 16,
        });
        for (const candidate of candidates) {
          const dispatch = await this.lockAndValidate(
            tx,
            candidate.id,
            registration,
            bootId,
            undefined,
            coordinationEpoch,
          );
          if (!dispatch) {
            continue;
          }
          const created = await this.grant(tx, dispatch, registration, bootId);
          return RunnerDispatchGrant.parse({
            ...assignment(created),
            envelopeId: dispatch.envelopeId,
            inputDigest: dispatch.inputDigest,
            plaintextBytes: dispatch.plaintextBytes,
            expiresAt: dispatch.expiresAt.toISOString(),
            plugin: dispatch.plugin,
          });
        }
        return null;
      },
      { isolationLevel: 'ReadCommitted', maxWait: 2_000, timeout: 5_000 },
    );
  }
}
