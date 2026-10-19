import type {
  RunnerStopReport,
  RunnerResultReconciliationRequest,
} from '@ai-runtime/contracts/http';
import {
  requireAuthority,
  type Principal,
} from '../../identity/domain/principal.js';
import type { RunnerOutcomeAuthority } from './runner-outcome.port.js';

/** Quarantined observations and read-only matching; never completion/retirement authority. */
export class RunnerOutcomeService {
  constructor(private readonly authority: RunnerOutcomeAuthority) {}
  stop(principal: Principal, report: RunnerStopReport) {
    requireAuthority(principal, 'runner:report');
    return this.authority.stop(principal, report);
  }
  reconcileResult(
    principal: Principal,
    request: RunnerResultReconciliationRequest,
  ) {
    requireAuthority(principal, 'runner:report');
    return this.authority.reconcileResult(principal, request);
  }
}
