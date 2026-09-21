import { ApplicationError } from '../../../shared/domain/application-error.js';
import type { ApplicationIdentity } from '../../identity/domain/application-identity.js';
import type { ValidationRepository } from './ports/validation-repository.port.js';

export class ReadHistoryUseCase {
  constructor(private readonly records: ValidationRepository) {}

  async list(identity: ApplicationIdentity, limit: number, afterId?: string) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new ApplicationError('INVALID_REQUEST', 'limit must be 1â€“100.');
    }
    if (
      afterId &&
      !(await this.records.findOwned(identity.applicationId, afterId))
    ) {
      throw new ApplicationError('INVALID_REQUEST', 'Invalid page cursor.');
    }
    return this.records.listOwned(identity.applicationId, limit, afterId);
  }

  async get(identity: ApplicationIdentity, id: string) {
    const record = await this.records.findOwned(identity.applicationId, id);
    if (!record) {
      throw new ApplicationError('NOT_FOUND', 'Record not found.');
    }
    return record;
  }
}
