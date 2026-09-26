import type {
  Overview,
  PageInput,
  ResourceName,
  ResourcePages,
} from '@ai-runtime/contracts/http';
import type { Principal } from '../../identity/domain/principal.js';
export interface ResourceReader {
  list<R extends ResourceName>(
    principal: Principal,
    resource: R,
    query: PageInput,
  ): Promise<ResourcePages[R]>;
  overview(principal: Principal): Promise<Overview>;
}
export const RESOURCE_READER = Symbol('RESOURCE_READER');
