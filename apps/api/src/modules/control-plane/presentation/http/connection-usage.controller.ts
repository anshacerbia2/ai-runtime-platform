import { Controller, Param, Query } from '@nestjs/common';
import {
  apiContract,
  type ConnectionUsageInput,
} from '@ai-runtime/contracts/http';
import { ContractRoute } from '../../../../shared/presentation/contract-route.js';
import { CurrentPrincipal } from '../../../identity/presentation/http/current-principal.decorator.js';
import type { Principal } from '../../../identity/domain/principal.js';
import { ConnectionUsageService } from '../../application/connection-usage.service.js';

@Controller()
export class ConnectionUsageController {
  constructor(private readonly service: ConnectionUsageService) {}
  @ContractRoute(apiContract.resources.connections.usage)
  read(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Query() query: ConnectionUsageInput,
  ) {
    return this.service.read(principal, id, query);
  }
}
