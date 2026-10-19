import { Body, Controller, HttpCode } from '@nestjs/common';
import {
  apiContract,
  RunnerStopReport,
  RunnerResultReconciliationRequest,
} from '@ai-runtime/contracts/http';
import { ContractRoute } from '../../../../shared/presentation/contract-route.js';
import { CurrentPrincipal } from '../../../identity/presentation/http/current-principal.decorator.js';
import type { Principal } from '../../../identity/domain/principal.js';
import { RunnerOutcomeService } from '../../application/runner-outcome.service.js';

@Controller()
export class RunnerOutcomeController {
  constructor(private readonly service: RunnerOutcomeService) {}
  @ContractRoute(apiContract.runner.stop)
  @HttpCode(202)
  stop(@CurrentPrincipal() principal: Principal, @Body() body: unknown) {
    return this.service.stop(principal, RunnerStopReport.parse(body));
  }
  @ContractRoute(apiContract.runner.reconcileResult)
  @HttpCode(200)
  reconcileResult(
    @CurrentPrincipal() principal: Principal,
    @Body() body: unknown,
  ) {
    return this.service.reconcileResult(
      principal,
      RunnerResultReconciliationRequest.parse(body),
    );
  }
}
