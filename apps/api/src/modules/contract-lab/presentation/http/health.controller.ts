import {
  apiContract,
  type ServerInferResponseBody,
} from '@ai-runtime/contracts/http';
import { ContractRoute } from '../../../../shared/presentation/contract-route.js';
import { Controller, Inject } from '@nestjs/common';
import { CONTRACT_VERSION } from '@ai-runtime/contracts';
import { PublicRoute } from '../../../../shared/presentation/public-route.decorator.js';
import { CurrentApplication } from '../../../identity/presentation/http/current-application.decorator.js';
import type { ApplicationIdentity } from '../../../identity/domain/application-identity.js';
import { GetLabHealthUseCase } from '../../application/get-lab-health.use-case.js';

@Controller()
export class HealthController {
  constructor(
    @Inject(GetLabHealthUseCase) private readonly health: GetLabHealthUseCase,
  ) {}

  @PublicRoute()
  @ContractRoute(apiContract.live)
  live(): ServerInferResponseBody<typeof apiContract.live, 200> {
    return { status: 'ok', milestone: 'M2', mode: 'local-runtime' };
  }

  @ContractRoute(apiContract.lab.health)
  async ready(
    @CurrentApplication() identity: ApplicationIdentity,
  ): Promise<ServerInferResponseBody<typeof apiContract.lab.health, 200>> {
    const status = await this.health.execute(identity);
    return {
      backend: 'ready',
      database: 'PostgreSQL',
      mode: 'contract-only',
      application_id: status.applicationId,
      saved_checks: status.savedChecks,
      provider_calls: 0,
      contract_version: CONTRACT_VERSION,
      framework: 'NestJS + Fastify',
      persistence: 'Prisma',
    };
  }
}
