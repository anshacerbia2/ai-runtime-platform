import type {
  ConnectionUsageInput,
  ConnectionUsageSummary,
} from '@ai-runtime/contracts/http';

export interface ConnectionUsageReader {
  read(
    connectionId: string,
    query: ConnectionUsageInput,
  ): Promise<ConnectionUsageSummary | null>;
}
export const CONNECTION_USAGE_READER = Symbol('CONNECTION_USAGE_READER');
export interface ConnectionUsageQueryValidator {
  parse(connectionId: string, raw: unknown): ConnectionUsageInput;
}
export const CONNECTION_USAGE_QUERY = Symbol('CONNECTION_USAGE_QUERY');
