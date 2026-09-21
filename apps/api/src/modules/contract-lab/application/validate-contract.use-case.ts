import type { ApplicationIdentity } from '../../identity/domain/application-identity.js';
import { requireIdempotencyKey } from '../domain/idempotency-key.js';
import type {
  ContractKind,
  SavedValidation,
} from '../domain/validation-record.js';
import type {
  ContractPolicy,
  ProfileReader,
} from './ports/contract-policy.port.js';
import type { ValidationRepository } from './ports/validation-repository.port.js';

export interface ValidateContractCommand {
  readonly identity: ApplicationIdentity;
  readonly kind: ContractKind;
  readonly payload: unknown;
  readonly idempotencyKey: string;
}

export class ValidateContractUseCase {
  constructor(
    private readonly records: ValidationRepository,
    private readonly profiles: ProfileReader,
    private readonly policy: ContractPolicy,
  ) {}

  async execute(command: ValidateContractCommand): Promise<SavedValidation> {
    const idempotencyKey = requireIdempotencyKey(command.idempotencyKey);
    const applicationId = command.identity.applicationId;
    const profiles = await this.profiles.listOwned(applicationId);
    const prepared = this.policy.prepare(
      command.kind,
      command.payload,
      profiles,
    );

    // Only structural metadata and the validation report cross the persistence port.
    return this.records.saveIdempotent({
      applicationId,
      idempotencyKey,
      kind: command.kind,
      ...prepared,
    });
  }
}
