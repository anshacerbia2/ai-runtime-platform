import { Controller, Param, Query } from '@nestjs/common';
import {
  apiContract,
  type ToolOperationQuery,
} from '@ai-runtime/contracts/http';
import { ContractRoute } from '../../../../shared/presentation/contract-route.js';
import { CurrentPrincipal } from '../../../identity/presentation/http/current-principal.decorator.js';
import type { Principal } from '../../../identity/domain/principal.js';
import { ToolOperationStatusService } from '../../application/tool-operation-status.service.js';

@Controller()
export class ToolOperationStatusController {
  constructor(private readonly service: ToolOperationStatusService) {}
  @ContractRoute(apiContract.toolOperations.list)
  list(
    @CurrentPrincipal() principal: Principal,
    @Param('id') executionId: string,
    @Query() query: ToolOperationQuery,
  ) {
    return this.service.list(principal, executionId, query);
  }
  @ContractRoute(apiContract.toolOperations.status)
  status(
    @CurrentPrincipal() principal: Principal,
    @Param('id') executionId: string,
    @Param('operationId') operationId: string,
  ) {
    return this.service.read(principal, executionId, operationId);
  }
}
