import { ApplicationError } from '../../../shared/domain/application-error.js';
import type {
  PluginPackageIdentity,
  PluginPackageRecord,
  PluginPackageRepository,
  PluginPackageVerifier,
  StagedPluginPackage,
} from './plugin-registry.port.js';

const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const SCOPED = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const OBJECT_KEY =
  /^plugins\/v1\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ATTESTATION = /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,255}$/;

function validate(command: StagedPluginPackage): StagedPluginPackage {
  if (
    typeof command.applicationId !== 'string' ||
    !command.applicationId ||
    command.applicationId.length > 120 ||
    typeof command.packageId !== 'string' ||
    !ID.test(command.packageId) ||
    typeof command.version !== 'string' ||
    !ID.test(command.version) ||
    typeof command.bundleDigest !== 'string' ||
    !DIGEST.test(command.bundleDigest) ||
    typeof command.objectKey !== 'string' ||
    !OBJECT_KEY.test(command.objectKey) ||
    !Number.isSafeInteger(command.bundleBytes) ||
    command.bundleBytes < 2 ||
    command.bundleBytes > 16 * 1024 * 1024 ||
    !Array.isArray(command.compatibleRuntimeVersions) ||
    command.compatibleRuntimeVersions.length < 1 ||
    command.compatibleRuntimeVersions.length > 16 ||
    !command.compatibleRuntimeVersions.every(
      (item) => typeof item === 'string' && SCOPED.test(item),
    ) ||
    !Array.isArray(command.requiredPermissions) ||
    command.requiredPermissions.length > 64 ||
    !command.requiredPermissions.every(
      (item) => typeof item === 'string' && SCOPED.test(item),
    )
  ) {
    throw new ApplicationError('INVALID_REQUEST', 'Invalid plugin package.');
  }
  const runtimes = [...new Set(command.compatibleRuntimeVersions)].sort();
  const permissions = [...new Set(command.requiredPermissions)].sort();
  if (
    runtimes.length !== command.compatibleRuntimeVersions.length ||
    permissions.length !== command.requiredPermissions.length
  ) {
    throw new ApplicationError('INVALID_REQUEST', 'Duplicate plugin grants.');
  }
  return {
    ...command,
    compatibleRuntimeVersions: runtimes,
    requiredPermissions: permissions,
  };
}

export class PluginRegistryService {
  constructor(
    private readonly repository: PluginPackageRepository,
    private readonly verifier: PluginPackageVerifier,
  ) {}

  stage(command: StagedPluginPackage): Promise<PluginPackageRecord> {
    return this.repository.stage(validate(command));
  }

  async activate(
    identity: PluginPackageIdentity,
    expectedRevision: number,
  ): Promise<PluginPackageRecord> {
    const staged = await this.repository.find(identity);
    if (!staged || staged.state === 'REVOKED') {
      throw new ApplicationError('NOT_FOUND', 'Plugin package not available.');
    }
    if (staged.state === 'ACTIVE') {
      return staged;
    }
    if (staged.revision !== expectedRevision) {
      throw new ApplicationError(
        'IDEMPOTENCY_CONFLICT',
        'Plugin package revision changed.',
      );
    }
    const attestation = await this.verifier.verify(staged);
    if (
      attestation.bundleDigest !== staged.bundleDigest ||
      !ATTESTATION.test(attestation.attestationRef)
    ) {
      throw new ApplicationError(
        'POLICY_DENIED',
        'Plugin package attestation is invalid.',
      );
    }
    return this.repository.activate(identity, expectedRevision, attestation);
  }

  revoke(identity: PluginPackageIdentity, expectedRevision: number) {
    return this.repository.revoke(identity, expectedRevision);
  }

  async resolve(
    identity: PluginPackageIdentity,
    expectedDigest: string,
    runtimeVersion: string,
    allowedPermissions: readonly string[],
  ): Promise<PluginPackageRecord> {
    const current = await this.repository.find(identity);
    if (
      !current ||
      current.state !== 'ACTIVE' ||
      current.bundleDigest !== expectedDigest ||
      !current.compatibleRuntimeVersions.includes(runtimeVersion) ||
      !current.requiredPermissions.every((permission) =>
        allowedPermissions.includes(permission),
      )
    ) {
      throw new ApplicationError(
        'POLICY_DENIED',
        'Plugin package grant is unavailable.',
      );
    }
    return current;
  }
}
