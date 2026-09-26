import { api, successfulBody } from './api-client';
import type {
  ResourceName,
  ResourcePages,
  PageInput,
} from '@ai-runtime/contracts/http';
export const controlPlaneClient = {
  overview: async (signal?: AbortSignal) =>
    successfulBody(await api.resources.overview({ fetchOptions: { signal } })),
  async list<R extends ResourceName>(
    resource: R,
    query: PageInput = {},
    signal?: AbortSignal,
  ): Promise<ResourcePages[R]> {
    // Exhaustive operation selection keeps routing tied to the declared contract.
    const args = { query, fetchOptions: { signal } };
    switch (resource) {
      case 'applications':
        return successfulBody(
          await api.resources.applications.list(args),
        ) as ResourcePages[R];
      case 'connections':
        return successfulBody(
          await api.resources.connections.list(args),
        ) as ResourcePages[R];
      case 'credentials':
        return successfulBody(
          await api.resources.credentials.list(args),
        ) as ResourcePages[R];
      case 'bindings':
        return successfulBody(
          await api.resources.bindings.list(args),
        ) as ResourcePages[R];
      case 'profiles':
        return successfulBody(
          await api.resources.profiles.list(args),
        ) as ResourcePages[R];
      case 'aliases':
        return successfulBody(
          await api.resources.aliases.list(args),
        ) as ResourcePages[R];
      case 'budgets':
        return successfulBody(
          await api.resources.budgets.list(args),
        ) as ResourcePages[R];
      case 'pools':
        return successfulBody(
          await api.resources.pools.list(args),
        ) as ResourcePages[R];
      case 'runners':
        return successfulBody(
          await api.resources.runners.list(args),
        ) as ResourcePages[R];
      case 'audit':
        return successfulBody(
          await api.resources.audit.list(args),
        ) as ResourcePages[R];
      case 'outbox':
        return successfulBody(
          await api.resources.outbox.list(args),
        ) as ResourcePages[R];
      default:
        throw new TypeError('Unknown resource collection.');
    }
  },
};
