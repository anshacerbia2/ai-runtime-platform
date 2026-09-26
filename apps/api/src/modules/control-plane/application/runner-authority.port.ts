import type {
  AssignCommand,
  RevokeCommand,
  RunnerReport,
  LateEvidence,
  Assignment,
  EvidenceReceipt,
} from '@ai-runtime/contracts/http';
import type { Principal } from '../../identity/domain/principal.js';
export interface RunnerAuthority {
  grant(
    principal: Principal,
    executionId: string,
    command: AssignCommand,
    key: string,
  ): Promise<Assignment>;
  revoke(
    principal: Principal,
    executionId: string,
    command: RevokeCommand,
    key: string,
  ): Promise<Assignment>;
  report(principal: Principal, report: RunnerReport): Promise<Assignment>;
  evidence(
    principal: Principal,
    evidence: LateEvidence,
  ): Promise<EvidenceReceipt>;
}
export const RUNNER_AUTHORITY = Symbol('RUNNER_AUTHORITY');
