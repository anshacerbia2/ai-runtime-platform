import type { RunnerLeaseCommand } from '@ai-runtime/contracts/http';
import type { Principal } from '../../identity/domain/principal.js';
import { ApplicationError } from '../../../shared/domain/application-error.js';
import type {
  PluginPackageRecord,
  VerifiedPluginPackageReader,
} from './plugin-registry.port.js';

export interface RunnerPluginAuthorization {
  assertCurrent(
    principal: Principal,
    command: RunnerLeaseCommand,
    envelopeId: string,
  ): Promise<PluginPackageRecord>;
}

/** Delivers only the profile-pinned package while the exact boot and lease are current. */
export class PluginPackageDeliveryService {
  constructor(
    private readonly authorization: RunnerPluginAuthorization,
    private readonly reader: VerifiedPluginPackageReader,
  ) {}

  async read(
    principal: Principal,
    command: RunnerLeaseCommand,
    envelopeId: string,
  ): Promise<Uint8Array> {
    const before = await this.authorization.assertCurrent(
      principal,
      command,
      envelopeId,
    );
    if (before.state !== 'ACTIVE' || !before.attestationRef) {
      throw new ApplicationError(
        'POLICY_DENIED',
        'Plugin package is not active.',
      );
    }
    const result = await this.reader.readVerified(before);
    try {
      const after = await this.authorization.assertCurrent(
        principal,
        command,
        envelopeId,
      );
      if (
        after.state !== 'ACTIVE' ||
        after.applicationId !== before.applicationId ||
        after.packageId !== before.packageId ||
        after.version !== before.version ||
        after.bundleDigest !== before.bundleDigest ||
        after.revision !== before.revision ||
        after.attestationRef !== before.attestationRef ||
        result.attestation.bundleDigest !== before.bundleDigest ||
        result.attestation.attestationRef !== before.attestationRef
      ) {
        throw new ApplicationError(
          'POLICY_DENIED',
          'Plugin package grant changed during delivery.',
        );
      }
      return result.bytes;
    } catch (error) {
      result.bytes.fill(0);
      throw error;
    }
  }
}
