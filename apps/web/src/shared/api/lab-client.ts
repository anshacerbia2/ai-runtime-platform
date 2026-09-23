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

  /** Health has its own query lifecycle; catalogue errors cannot overwrite it. */
  async catalogue(signal?: AbortSignal): Promise<LabCatalogue> {
    const [profiles, examples, schemas] = await Promise.all([
      api.lab.profiles({ fetchOptions: { signal } }).then(successfulBody),
      api.lab.examples({ fetchOptions: { signal } }).then(successfulBody),
      api.lab.schemas({ fetchOptions: { signal } }).then(successfulBody),
    ]);
    return {
      profiles: profiles.items,
      examples: examples.items,
      schemas: schemas.schemas,
    };
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
