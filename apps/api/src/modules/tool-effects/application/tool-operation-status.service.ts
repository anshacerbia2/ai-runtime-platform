import type { ToolOperationQuery } from '@ai-runtime/contracts/http';
import type { Principal } from '../../identity/domain/principal.js';
import { requireAuthority } from '../../identity/domain/principal.js';
import { ApplicationError } from '../../../shared/domain/application-error.js';
import type { ToolOperationStatusReader } from './tool-operation-status.port.js';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function scope(principal: Principal): string {
  requireAuthority(principal, 'execution:read');
  if (!principal.applicationId?.trim()) {
    throw new ApplicationError('POLICY_DENIED', 'Operation is not authorized.');
  }
  return principal.applicationId;
}
function id(value: string): string {
  if (!UUID.test(value)) {
    throw new ApplicationError(
      'INVALID_REQUEST',
      'Invalid resource identifier.',
    );
  }
  return value;
}
export class ToolOperationStatusService {
  constructor(private readonly reader: ToolOperationStatusReader) {}

  async read(principal: Principal, executionId: string, operationId: string) {
    const applicationId = scope(principal);
    const result = await this.reader.read(
      applicationId,
      id(executionId),
      id(operationId),
    );
    if (!result) {
      throw new ApplicationError('NOT_FOUND', 'Tool operation not found.');
    }
    return result;
  }

  list(principal: Principal, executionId: string, query: ToolOperationQuery) {
    const applicationId = scope(principal);
    if (
      Object.keys(query).some((key) => key !== 'limit' && key !== 'after') ||
      (query.limit !== undefined &&
        !/^(?:[1-9]|[1-9][0-9]|100)$/.test(query.limit)) ||
      (query.after !== undefined && !UUID.test(query.after))
    ) {
      throw new ApplicationError('INVALID_REQUEST', 'Invalid pagination.');
    }
    return this.reader.list(applicationId, id(executionId), {
      limit: Number(query.limit ?? '25'),
      ...(query.after ? { after: query.after } : {}),
    });
  }
}
