import { ConnectionUsageQuery, ResourceId } from '@ai-runtime/contracts/http';
import type { ConnectionUsageQueryValidator } from '../application/connection-usage.port.js';
import { ApplicationError } from '../../../shared/domain/application-error.js';

export class ContractConnectionUsageQueryValidator implements ConnectionUsageQueryValidator {
  parse(connectionId: string, raw: unknown) {
    const query = ConnectionUsageQuery.safeParse(raw);
    if (!ResourceId.safeParse(connectionId).success || !query.success) {
      throw new ApplicationError(
        'INVALID_REQUEST',
        'Invalid connection usage query.',
      );
    }
    return query.data;
  }
}
