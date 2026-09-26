import { api, successfulBody } from './api-client';
import type {
  apiContract,
  ClientInferRequest,
  LabCatalogue,
} from '@ai-runtime/contracts/http';

export type {
  Example,
  HistoryResponse,
  LabCatalogue,
  LabHealth,
  SavedValidation,
} from '@ai-runtime/contracts/http';

type ValidationBody = ClientInferRequest<
  typeof apiContract.lab.validate
>['body'];

export const labClient = {
  health: async (signal?: AbortSignal) =>
    successfulBody(await api.lab.health({ fetchOptions: { signal } })),

  /** One domain-facing catalogue read; storage composition stays behind the API. */
  async catalogue(signal?: AbortSignal): Promise<LabCatalogue> {
    return successfulBody(
      await api.lab.catalogue({ fetchOptions: { signal } }),
    );
  },

  validate: async (body: ValidationBody, key: string, signal?: AbortSignal) =>
    successfulBody(
      await api.lab.validate({
        body,
        headers: { 'idempotency-key': key },
        fetchOptions: { signal },
      }),
    ),

  history: async (cursor?: string | null, signal?: AbortSignal) =>
    successfulBody(
      await api.lab.history({
        query: cursor ? { cursor } : {},
        fetchOptions: { signal },
      }),
    ),
};
