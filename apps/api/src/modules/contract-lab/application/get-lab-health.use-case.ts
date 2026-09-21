import type { ApplicationIdentity } from '../../identity/domain/application-identity.js';
import type { DatabaseProbe } from './ports/contract-policy.port.js';
import type { ValidationRepository } from './ports/validation-repository.port.js';

export class GetLabHealthUseCase {
  constructor(
    private readonly database: DatabaseProbe,
    private readonly records: ValidationRepository,
  ) {}

  async execute(identity: ApplicationIdentity) {
    await this.database.check();
    const count = await this.records.countOwned(identity.applicationId);
    return { applicationId: identity.applicationId, savedChecks: count };
  }
}
