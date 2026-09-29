import type {
  RunnerDispatchClaimResult,
  RunnerHeartbeat,
} from '@ai-runtime/contracts/http';
import { ApplicationError } from '../../../shared/domain/application-error.js';
import type { Principal } from '../../identity/domain/principal.js';
import { requireAuthority } from '../../identity/domain/principal.js';
import type { RunnerDispatchRepository } from './runner-dispatch.port.js';
import type { RunnerLivenessRegistry } from './runner-liveness-registry.port.js';
import type { RunnerPresenceStore } from './runner-presence-store.port.js';

export class RunnerDispatchService {
  constructor(
    private readonly registry: RunnerLivenessRegistry,
    private readonly presence: RunnerPresenceStore,
    private readonly repository: RunnerDispatchRepository,
  ) {}

  async claim(
    principal: Principal,
    input: RunnerHeartbeat,
  ): Promise<RunnerDispatchClaimResult> {
    requireAuthority(principal, 'runner:report');
    const registration = await this.registry.authorizeHeartbeat(
      principal,
      input.runnerId,
      input.registrationRevision,
    );
    let current;
    try {
      current = await this.presence.inspect({
        ...registration,
        bootId: input.bootId,
      });
    } catch {
      throw new ApplicationError(
        'DEPENDENCY_UNAVAILABLE',
        'Runner coordination is unavailable; dispatch is paused.',
      );
    }
    if (current !== 'CURRENT') {
      throw new ApplicationError(
        'STALE_RUNNER_REGISTRATION',
        'Runner process must publish a current heartbeat before claiming work.',
      );
    }
    return { grant: await this.repository.claim(registration) };
  }
}
