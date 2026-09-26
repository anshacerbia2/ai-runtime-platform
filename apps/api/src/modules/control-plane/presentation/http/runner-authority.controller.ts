import { Body, Controller, Headers, HttpCode, Param } from '@nestjs/common';
import {
  apiContract,
  AssignCommand,
  RevokeCommand,
  RunnerReport,
  LateEvidence,
} from '@ai-runtime/contracts/http';
import { ContractRoute } from '../../../../shared/presentation/contract-route.js';
import { CurrentPrincipal } from '../../../identity/presentation/http/current-principal.decorator.js';
import type { Principal } from '../../../identity/domain/principal.js';
import { RunnerAuthorityService } from '../../application/runner-authority.service.js';
@Controller()
export class RunnerAuthorityController {
  constructor(private readonly service: RunnerAuthorityService) {}
  @ContractRoute(apiContract.runner.protocol)
  protocol(@CurrentPrincipal() p: Principal) {
    return this.service.protocol(p);
  }
  @ContractRoute(apiContract.assignments.grant)
  @HttpCode(200)
  grant(
    @CurrentPrincipal() p: Principal,
    @Param('id') id: string,
    @Headers('idempotency-key') key: string,
    @Body() body: unknown,
  ) {
    return this.service.grant(p, id, AssignCommand.parse(body), key);
  }
  @ContractRoute(apiContract.assignments.revoke)
  @HttpCode(200)
  revoke(
    @CurrentPrincipal() p: Principal,
    @Param('id') id: string,
    @Headers('idempotency-key') key: string,
    @Body() body: unknown,
  ) {
    return this.service.revoke(p, id, RevokeCommand.parse(body), key);
  }
  @ContractRoute(apiContract.runner.report)
  @HttpCode(200)
  report(@CurrentPrincipal() p: Principal, @Body() body: unknown) {
    return this.service.report(p, RunnerReport.parse(body));
  }
  @ContractRoute(apiContract.runner.evidence)
  @HttpCode(202)
  evidence(@CurrentPrincipal() p: Principal, @Body() body: unknown) {
    return this.service.evidence(p, LateEvidence.parse(body));
  }
}
