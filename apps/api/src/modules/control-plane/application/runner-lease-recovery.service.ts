import type { RunnerLeaseRecovery } from './runner-lease-recovery.port.js';
import type { RunnerLeaseStore } from './runner-lease-store.port.js';

const SCAN_LIMIT = 64;

export class RunnerLeaseRecoveryService {
  private cursor: string | null = null;

  constructor(
    private readonly repository: RunnerLeaseRecovery,
    private readonly leases: RunnerLeaseStore,
  ) {}

  async recover(): Promise<number> {
    const candidates = await this.repository.scan(this.cursor, SCAN_LIMIT);
    let fenced = 0;
    for (const candidate of candidates) {
      const match = candidate.proof
        ? await this.leases.inspectDurable(candidate.proof)
        : null;
      if (
        match !== 'CURRENT' &&
        (await this.repository.fence(
          candidate,
          match === null
            ? 'ACTIVATION_TIMEOUT'
            : match === 'MISSING'
              ? 'LEASE_MISSING'
              : 'LEASE_MISMATCH',
        ))
      ) {
        fenced += 1;
      }
      this.cursor = candidate.assignmentId;
    }
    if (candidates.length < SCAN_LIMIT) {
      this.cursor = null;
    }
    return fenced;
  }
}
