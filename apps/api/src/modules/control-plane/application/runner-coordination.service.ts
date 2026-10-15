import { ApplicationError } from '../../../shared/domain/application-error.js';
import type { RunnerLeaseRecovery } from './runner-lease-recovery.port.js';
import type {
  RunnerCoordinationAuthority,
  RunnerCoordinationStore,
} from './runner-coordination.port.js';

const RECOVERY_BATCH = 64;

/** Redis loss pauses placement; PostgreSQL fences old owners before reopening. */
export class RunnerCoordinationService {
  constructor(
    private readonly authority: RunnerCoordinationAuthority,
    private readonly recovery: RunnerLeaseRecovery,
    private readonly store: RunnerCoordinationStore | null,
  ) {}

  async assertActive(): Promise<void> {
    if (!this.store) {
      return;
    }
    const current = await this.authority.read();
    if (current.state !== 'ACTIVE') {
      throw new ApplicationError(
        'DEPENDENCY_UNAVAILABLE',
        'Runner coordination is paused for epoch recovery.',
      );
    }
    let marker: string | null;
    try {
      marker = await this.store.read();
    } catch {
      throw new ApplicationError(
        'DEPENDENCY_UNAVAILABLE',
        'Runner coordination is unavailable.',
      );
    }
    if (marker !== current.marker || marker === null) {
      await this.authority.pauseIfCurrent(current);
      throw new ApplicationError(
        'DEPENDENCY_UNAVAILABLE',
        'Runner coordination epoch changed; dispatch is paused.',
      );
    }
  }

  async recover(): Promise<number> {
    if (!this.store) {
      return 0;
    }
    const current = await this.authority.read();
    if (current.state === 'ACTIVE') {
      await this.assertActive();
      return 0;
    }
    const candidates = await this.recovery.scanActive(RECOVERY_BATCH);
    let fenced = 0;
    for (const candidate of candidates) {
      if (await this.recovery.fence(candidate, 'EPOCH_LOST')) {
        fenced += 1;
      }
    }
    await this.authority.resume(this.store);
    return fenced;
  }
}
