import type { Principal } from '../../identity/domain/principal.js';
import { requireAuthority } from '../../identity/domain/principal.js';
import { ApplicationError } from '../../../shared/domain/application-error.js';
import type {
  ConnectionUsageReader,
  ConnectionUsageQueryValidator,
} from './connection-usage.port.js';

export class ConnectionUsageService {
  constructor(
    private readonly reader: ConnectionUsageReader,
    private readonly validator: ConnectionUsageQueryValidator,
  ) {}
  async read(principal: Principal, connectionId: string, raw: unknown) {
    requireAuthority(principal, 'platform:read');
    const query = this.validator.parse(connectionId, raw);
    const result = await this.reader.read(connectionId, query);
    if (!result) {
      throw new ApplicationError(
        'NOT_FOUND',
        'Connection or selected scope not found.',
      );
    }
    return result;
  }
}
