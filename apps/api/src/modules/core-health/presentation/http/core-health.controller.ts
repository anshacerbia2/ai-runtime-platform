import {
  apiContract,
  type ServerInferResponseBody,
} from '@ai-runtime/contracts/http';
import { Controller } from '@nestjs/common';
import { ContractRoute } from '../../../../shared/presentation/contract-route.js';
import { PublicRoute } from '../../../../shared/presentation/public-route.decorator.js';

@Controller()
export class CoreHealthController {
  @PublicRoute()
  @ContractRoute(apiContract.live)
  live(): ServerInferResponseBody<typeof apiContract.live, 200> {
    return { status: 'ok', milestone: 'M2', mode: 'local-runtime' };
  }
}
