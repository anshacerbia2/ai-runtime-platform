import type {
  RunnerHeartbeat,
  RunnerHeartbeatAck,
} from '@ai-runtime/contracts/http';
import { ApplicationError } from '../../../shared/domain/application-error.js';
import type { Principal } from '../../identity/domain/principal.js';
import { requireAuthority } from '../../identity/domain/principal.js';
import type { RunnerLivenessRegistry } from './runner-liveness-registry.port.js';
import type { RunnerPresenceStore } from './runner-presence-store.port.js';

export const RUNNER_HEARTBEAT_INTERVAL_MS = 5_000;
export const RUNNER_PRESENCE_TTL_MS = 15_000;

export class RunnerLivenessService {
  constructor(
    private readonly registry: RunnerLivenessRegistry,
    private readonly presence: RunnerPresenceStore,
  ) {}

  async heartbeat(
    principal: Principal,
    input: RunnerHeartbeat,
  ): Promise<RunnerHeartbeatAck> {
    requireAuthority(principal, 'runner:register');
    const registration = await this.registry.authorizeHeartbeat(
      principal,
      input.runnerId,
      input.registrationRevision,
    );
    try {
      await this.presence.heartbeat(
        { ...registration, bootId: input.bootId },
        RUNNER_PRESENCE_TTL_MS,
      );
    } catch {
      throw new ApplicationError(
        'DEPENDENCY_UNAVAILABLE',
        'Runner coordination is unavailable; stop accepting new work.',
      );
    }
    return {
      runnerId: registration.runnerId,
      bootId: input.bootId,
      registrationRevision: registration.registrationRevision,
      state: 'ALIVE',
      heartbeatIntervalMs: RUNNER_HEARTBEAT_INTERVAL_MS,
      presenceTtlMs: RUNNER_PRESENCE_TTL_MS,
    };
  }
}
