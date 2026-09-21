import type {
  CheckResult,
  ContractKind,
  ProfileType,
} from '@ai-runtime/contracts';

export interface ValidationRecord {
  readonly id: string;
  readonly applicationId: string;
  readonly kind: ContractKind;
  readonly valid: boolean;
  readonly contractVersion: string;
  readonly requestDigest: string;
  readonly requestSummary: unknown;
  readonly report: CheckResult;
  readonly createdAt: Date;
}

export interface ValidationDraft {
  readonly applicationId: string;
  readonly idempotencyKey: string;
  readonly kind: ContractKind;
  readonly requestDigest: string;
  readonly requestSummary: unknown;
  readonly report: CheckResult;
}

export interface SavedValidation {
  readonly record: ValidationRecord;
  readonly replayed: boolean;
}

export interface HistoryPage {
  readonly items: ValidationRecord[];
  readonly nextId: string | null;
}

export interface PreparedValidation {
  readonly report: CheckResult;
  readonly requestSummary: unknown;
  readonly requestDigest: string;
}

export type { CheckResult, ContractKind, ProfileType };
