import type {
  ContractKind,
  PreparedValidation,
  ProfileType,
} from '../../domain/validation-record.js';

export interface ContractPolicy {
  prepare(
    kind: ContractKind,
    payload: unknown,
    profiles: ProfileType[],
  ): PreparedValidation;
}
export const CONTRACT_POLICY = Symbol('ContractPolicy');

export interface ProfileReader {
  listOwned(applicationId: string): Promise<ProfileType[]>;
}
export const PROFILE_READER = Symbol('ProfileReader');

export interface DatabaseProbe {
  check(): Promise<void>;
}
export const DATABASE_PROBE = Symbol('DatabaseProbe');
