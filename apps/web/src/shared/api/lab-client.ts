import type {
  CheckResult,
  ContractKind,
  ProfileType,
} from '@ai-runtime/contracts';
import { requestJson } from './http-client.js';

export interface Example {
  id: string;
  title: string;
  kind: ContractKind;
  payload: unknown;
}
export interface SavedValidation {
  id: string;
  application_id: string;
  kind: ContractKind;
  valid: boolean;
  report: CheckResult;
  created_at: string;
  request_summary: unknown;
  request_digest: string;
  replayed?: boolean;
}
export interface LabHealth {
  backend: string;
  database: string;
  application_id: string;
  saved_checks: number;
  contract_version: string;
}
export interface HistoryResponse {
  items: SavedValidation[];
  next_cursor: string | null;
}
export interface LabResources {
  health: LabHealth;
  profiles: ProfileType[];
  examples: Example[];
  schemas: Record<string, unknown>;
}

export const labClient = {
  health: () => requestJson<LabHealth>('health'),
  async resources(signal?: AbortSignal): Promise<LabResources> {
    const [health, profiles, examples, contracts] = await Promise.all([
      requestJson<LabHealth>('health', { signal }),
      requestJson<{ items: ProfileType[] }>('profiles', { signal }),
      requestJson<{ items: Example[] }>('examples', { signal }),
      requestJson<{ schemas: Record<string, unknown> }>('contracts', {
        signal,
      }),
    ]);
    return {
      health,
      profiles: profiles.items,
      examples: examples.items,
      schemas: contracts.schemas,
    };
  },
  validate: (kind: ContractKind, payload: unknown, key: string) =>
    requestJson<SavedValidation>('validations', {
      method: 'POST',
      headers: { 'Idempotency-Key': key },
      body: JSON.stringify({ kind, payload }),
    }),
  history: (cursor?: string | null) =>
    requestJson<HistoryResponse>(
      'history' + (cursor ? '?cursor=' + encodeURIComponent(cursor) : ''),
    ),
};
