import type { DatabaseService } from '../../../infrastructure/database/database.service.js';
import { ApplicationError } from '../../../shared/domain/application-error.js';
import type { Principal } from '../../identity/domain/principal.js';
import type {
  RunnerLivenessRegistry,
  RunnerRegistrationIdentity,
} from '../application/runner-liveness-registry.port.js';

export class PrismaRunnerLivenessRegistry implements RunnerLivenessRegistry {
  constructor(private readonly db: DatabaseService) {}

  async authorizeHeartbeat(
    principal: Principal,
    runnerId: string,
    registrationRevision: number,
  ): Promise<RunnerRegistrationIdentity> {
    const runner = await this.db.runnerNode.findUnique({
      where: { id: runnerId },
      include: { pool: true },
    });
    if (!runner || runner.ownerSubject !== principal.subject) {
      throw new ApplicationError(
        'POLICY_DENIED',
        'Runner heartbeat identity is not authorized.',
      );
    }
    if (runner.revision !== registrationRevision) {
      throw new ApplicationError(
        'STALE_RUNNER_REGISTRATION',
        'Runner must re-register before sending another heartbeat.',
      );
    }
    if (runner.status === 'DISABLED' || runner.pool.status !== 'ENABLED') {
      throw new ApplicationError(
        'POLICY_DENIED',
        'Runner or runner pool is disabled.',
      );
    }
    return {
      runnerId: runner.id,
      ownerSubject: runner.ownerSubject,
      registrationRevision: runner.revision,
    };
  }
}
