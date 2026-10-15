import type { RunnerLeaseCommand } from '@ai-runtime/contracts/http';
import type { DatabaseService } from '../../../infrastructure/database/database.service.js';
import { ApplicationError } from '../../../shared/domain/application-error.js';
import type { DispatchPayloadAuthorization } from '../../dispatch-envelope/application/dispatch-envelope.ports.js';
import type { Principal } from '../../identity/domain/principal.js';
import type { RunnerPluginAuthorization } from '../application/plugin-package-delivery.service.js';
import { pluginPackageRecord } from './prisma-plugin-package.repository.js';

/** Reuses the durable payload binding and live lease; runners cannot choose package identity. */
export class PrismaRunnerPluginAuthorization implements RunnerPluginAuthorization {
  constructor(
    private readonly database: DatabaseService,
    private readonly dispatch: DispatchPayloadAuthorization,
  ) {}

  async assertCurrent(
    principal: Principal,
    command: RunnerLeaseCommand,
    envelopeId: string,
  ) {
    const { applicationId } = await this.dispatch.assertCurrent(
      principal,
      command,
      envelopeId,
    );
    const execution = await this.database.execution.findFirst({
      where: { id: command.token.executionId, applicationId },
      include: { profile: { include: { pluginPackage: true } } },
    });
    const profile = execution?.profile;
    const plugin = profile?.pluginPackage;
    if (
      !profile ||
      !plugin ||
      plugin.applicationId !== applicationId ||
      plugin.state !== 'ACTIVE' ||
      plugin.bundleDigest.trim() !== profile.pluginDigest?.trim() ||
      !profile.pluginRuntimeVersion ||
      !plugin.compatibleRuntimeVersions.includes(profile.pluginRuntimeVersion)
    ) {
      throw new ApplicationError(
        'POLICY_DENIED',
        'Runner has no active pinned plugin package.',
      );
    }
    return pluginPackageRecord(plugin);
  }
}
