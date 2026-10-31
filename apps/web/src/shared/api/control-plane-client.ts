import { api, successfulBody } from './api-client';
import type {
  ResourceName,
  ResourcePages,
  PageInput,
  ConnectionUsageInput,
} from '@ai-runtime/contracts/http';
import { ApiClientError } from './http-error';

export async function readConnectionUsage(
  connectionId: string,
  query: ConnectionUsageInput,
  signal?: AbortSignal,
  client = api,
) {
  const result = successfulBody(
    await client.resources.connections.usage({
      params: { id: connectionId },
      query,
      fetchOptions: { signal },
    }),
  );
  if (
    result.connectionId !== connectionId ||
    result.applicationId !== (query.applicationId ?? null) ||
    Date.parse(result.from) !== Date.parse(query.from) ||
    Date.parse(result.to) !== Date.parse(query.to) ||
    (query.budgetAccountId
      ? result.ledger?.accountId !== query.budgetAccountId
      : result.ledger !== null)
  ) {
    throw new ApiClientError({
      kind: 'invalid-response',
      status: 200,
      code: 'USAGE_SCOPE_MISMATCH',
      message: 'Usage response did not match the selected account and filters.',
    });
  }
  return result;
}
export const controlPlaneClient = {
  usage: readConnectionUsage,
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
