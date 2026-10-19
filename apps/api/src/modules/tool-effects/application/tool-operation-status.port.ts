import type {
  ToolOperationPage,
  ToolOperationStatus,
} from '@ai-runtime/contracts/http';

export const TOOL_OPERATION_STATUS_READER = Symbol(
  'TOOL_OPERATION_STATUS_READER',
);
export interface ToolOperationStatusReader {
  read(
    applicationId: string,
    executionId: string,
    operationId: string,
  ): Promise<ToolOperationStatus | null>;
  list(
    applicationId: string,
    executionId: string,
    query: { limit: number; after?: string },
  ): Promise<ToolOperationPage>;
}
