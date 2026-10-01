import type { PluginPackage } from '../../../infrastructure/database/generated/client.js';
import type { DatabaseService } from '../../../infrastructure/database/database.service.js';
import { ApplicationError } from '../../../shared/domain/application-error.js';
import type {
  PluginPackageAttestation,
  PluginPackageIdentity,
  PluginPackageRecord,
  PluginPackageRepository,
  StagedPluginPackage,
} from '../application/plugin-registry.port.js';

function prismaCode(error: unknown, code: string) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === code
  );
}

function record(row: PluginPackage): PluginPackageRecord {
  if (!['STAGED', 'ACTIVE', 'REVOKED'].includes(row.state)) {
    throw new Error('Unexpected plugin package state.');
  }
  return {
    applicationId: row.applicationId,
    packageId: row.packageId,
    version: row.version,
    bundleDigest: row.bundleDigest.trim(),
    objectKey: row.objectKey,
    bundleBytes: row.bundleBytes,
    compatibleRuntimeVersions: row.compatibleRuntimeVersions,
    requiredPermissions: row.requiredPermissions,
    state: row.state as PluginPackageRecord['state'],
    attestationRef: row.attestationRef,
    revision: row.revision,
  };
}

function samePackage(
  existing: PluginPackageRecord,
  command: StagedPluginPackage,
) {
  if (
    existing.bundleDigest !== command.bundleDigest ||
    existing.objectKey !== command.objectKey ||
    existing.bundleBytes !== command.bundleBytes ||
    existing.compatibleRuntimeVersions.join('\0') !==
      command.compatibleRuntimeVersions.join('\0') ||
    existing.requiredPermissions.join('\0') !==
      command.requiredPermissions.join('\0')
  ) {
    throw new ApplicationError(
      'IDEMPOTENCY_CONFLICT',
      'Plugin package version has different immutable metadata.',
    );
  }
  return existing;
}

export class PrismaPluginPackageRepository implements PluginPackageRepository {
  constructor(private readonly database: DatabaseService) {}

  private key(identity: PluginPackageIdentity) {
    return {
      applicationId_packageId_version: {
        applicationId: identity.applicationId,
        packageId: identity.packageId,
        version: identity.version,
      },
    };
  }

  private scope(identity: PluginPackageIdentity) {
    return {
      applicationId: identity.applicationId,
      packageId: identity.packageId,
      version: identity.version,
    };
  }

  async find(
    identity: PluginPackageIdentity,
  ): Promise<PluginPackageRecord | null> {
    const row = await this.database.pluginPackage.findUnique({
      where: this.key(identity),
    });
    return row ? record(row) : null;
  }

  async stage(command: StagedPluginPackage): Promise<PluginPackageRecord> {
    try {
      const row = await this.database.pluginPackage.create({
        data: {
          applicationId: command.applicationId,
          packageId: command.packageId,
          version: command.version,
          bundleDigest: command.bundleDigest,
          objectKey: command.objectKey,
          bundleBytes: command.bundleBytes,
          compatibleRuntimeVersions: [...command.compatibleRuntimeVersions],
          requiredPermissions: [...command.requiredPermissions],
        },
      });
      return record(row);
    } catch (error) {
      if (!prismaCode(error, 'P2002')) {
        throw error;
      }
      const existing = await this.find(command);
      if (existing) {
        return samePackage(existing, command);
      }
      throw new ApplicationError(
        'IDEMPOTENCY_CONFLICT',
        'Plugin package object key already belongs to another package.',
      );
    }
  }

  async activate(
    identity: PluginPackageIdentity,
    expectedRevision: number,
    attestation: PluginPackageAttestation,
  ): Promise<PluginPackageRecord> {
    const changed = await this.database.pluginPackage.updateMany({
      where: {
        ...this.scope(identity),
        state: 'STAGED',
        revision: expectedRevision,
        bundleDigest: attestation.bundleDigest,
      },
      data: {
        state: 'ACTIVE',
        attestationRef: attestation.attestationRef,
        revision: { increment: 1 },
        updatedAt: new Date(),
      },
    });
    const result = await this.find(identity);
    if (changed.count === 1 && result) {
      return result;
    }
    if (
      result?.state === 'ACTIVE' &&
      result.bundleDigest === attestation.bundleDigest
    ) {
      return result;
    }
    throw new ApplicationError(
      'IDEMPOTENCY_CONFLICT',
      'Plugin package activation lost its revision.',
    );
  }

  async revoke(
    identity: PluginPackageIdentity,
    expectedRevision: number,
  ): Promise<PluginPackageRecord> {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
      throw new ApplicationError(
        'INVALID_REQUEST',
        'Invalid package revision.',
      );
    }
    const changed = await this.database.pluginPackage.updateMany({
      where: {
        ...this.scope(identity),
        state: { in: ['STAGED', 'ACTIVE'] },
        revision: expectedRevision,
      },
      data: {
        state: 'REVOKED',
        revision: { increment: 1 },
        updatedAt: new Date(),
      },
    });
    const result = await this.find(identity);
    if (changed.count === 1 && result) {
      return result;
    }
    if (result?.state === 'REVOKED') {
      return result;
    }
    throw new ApplicationError(
      'IDEMPOTENCY_CONFLICT',
      'Plugin package revocation lost its revision.',
    );
  }
}
