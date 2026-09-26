import type { ManagementCommand } from '@ai-runtime/contracts';
import type { PageInput, ResourceName } from '@ai-runtime/contracts/http';
import type { Principal } from '../../identity/domain/principal.js';
import { requireAuthority } from '../../identity/domain/principal.js';
import { ApplicationError } from '../../../shared/domain/application-error.js';
import type { ResourceReader } from './resource-read.port.js';
import type { M1Repository } from './m1-repository.port.js';
export class ResourceService {
  constructor(
    private readonly reader: ResourceReader,
    private readonly mutations: M1Repository,
  ) {}
  list<R extends ResourceName>(
    principal: Principal,
    resource: R,
    query: PageInput,
  ) {
    requireAuthority(principal, 'platform:read');
    return this.reader.list(principal, resource, query);
  }
  overview(principal: Principal) {
    requireAuthority(principal, 'platform:read');
    return this.reader.overview(principal);
  }
  manage(principal: Principal, command: ManagementCommand, key: string) {
    requireAuthority(principal, 'platform:manage');
    if (!/^[A-Za-z0-9._:-]{1,160}$/.test(key)) {
      throw new ApplicationError(
        'INVALID_REQUEST',
        'A valid request key is required.',
      );
    }
    return this.mutations.manageReceipted(principal, command, key);
  }
}
