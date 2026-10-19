import type {
  RunnerStopReport,
  RunnerStopReceipt,
  RunnerResultReconciliationRequest,
  RunnerResultReconciliation,
} from '@ai-runtime/contracts/http';
import type { Principal } from '../../identity/domain/principal.js';

export interface RunnerOutcomeAuthority {
  stop(
    principal: Principal,
    report: RunnerStopReport,
  ): Promise<RunnerStopReceipt>;
  reconcileResult(
    principal: Principal,
    request: RunnerResultReconciliationRequest,
  ): Promise<RunnerResultReconciliation>;
}
export const RUNNER_OUTCOME_AUTHORITY = Symbol('RUNNER_OUTCOME_AUTHORITY');
