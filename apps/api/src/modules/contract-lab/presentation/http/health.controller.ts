import { Controller, Get, Inject } from '@nestjs/common';
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
  @Get('health/live')
  live() {
    return { status: 'ok', milestone: 'M0', mode: 'contract-only' };
  }

  @Get('api/m0/health')
  async ready(@CurrentApplication() identity: ApplicationIdentity) {
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
