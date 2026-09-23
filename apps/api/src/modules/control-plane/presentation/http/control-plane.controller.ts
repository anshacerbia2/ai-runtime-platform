import {
  apiContract,
  type ServerInferResponseBody,
} from '@ai-runtime/contracts/http';
import { ContractRoute } from '../../../../shared/presentation/contract-route.js';
import { Body, Controller, Headers, Param, Query, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import {
  AdmissionCommand,
  ArtifactCommand,
  ManagementCommand,
  RunnerRegistration,
  UsageCommand,
} from '@ai-runtime/contracts';
import { ApplicationError } from '../../../../shared/domain/application-error.js';
import { CurrentPrincipal } from '../../../identity/presentation/http/current-principal.decorator.js';
import type { Principal } from '../../../identity/domain/principal.js';
import { M1ControlPlaneService } from '../../application/m1-control-plane.service.js';

function parse<T>(
  schema: {
    safeParse(value: unknown): { success: true; data: T } | { success: false };
  },
  value: unknown,
  message: string,
): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ApplicationError('INVALID_REQUEST', message);
  }
  return parsed.data;
}
@Controller()
export class ControlPlaneController {
  constructor(private readonly service: M1ControlPlaneService) {}

  @ContractRoute(apiContract.controlPlane.snapshot)
  read(
    @CurrentPrincipal() principal: Principal,
  ): Promise<
    ServerInferResponseBody<typeof apiContract.controlPlane.snapshot, 200>
  > {
    return this.service.readSnapshot(principal);
  }

  @ContractRoute(apiContract.controlPlane.manage)
  manage(
    @CurrentPrincipal() principal: Principal,
    @Body() body: ManagementCommand,
  ): Promise<
    ServerInferResponseBody<typeof apiContract.controlPlane.manage, 200>
  > {
    return this.service.manage(
      principal,
      parse(ManagementCommand, body, 'Invalid management command.'),
    );
  }

  @ContractRoute(apiContract.controlPlane.admit)
  async admit(
    @CurrentPrincipal() principal: Principal,
    @Headers('idempotency-key') key: string | undefined,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: FastifyReply,
  ): Promise<
    ServerInferResponseBody<typeof apiContract.controlPlane.admit, 200 | 201>
  > {
    const result = await this.service.admit(
      principal,
      parse(AdmissionCommand, body, 'Invalid admission command.'),
      typeof key === 'string' ? key : '',
    );
    response.code(result.replayed ? 200 : 201);
    return result;
  }
  @ContractRoute(apiContract.controlPlane.execution)
  execution(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
  ): Promise<
    ServerInferResponseBody<typeof apiContract.controlPlane.execution, 200>
  > {
    return this.service.readExecution(principal, id);
  }

  @ContractRoute(apiContract.controlPlane.cancel)
  cancel(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<
    ServerInferResponseBody<typeof apiContract.controlPlane.cancel, 201>
  > {
    const reason =
      typeof body === 'object' &&
      body !== null &&
      'reason' in body &&
      typeof (body as { reason?: unknown }).reason === 'string'
        ? (body as { reason: string }).reason
        : null;
    return this.service.cancelExecution(principal, id, reason);
  }

  @ContractRoute(apiContract.controlPlane.usage)
  usage(
    @CurrentPrincipal() principal: Principal,
    @Body() body: UsageCommand,
  ): Promise<
    ServerInferResponseBody<typeof apiContract.controlPlane.usage, 201>
  > {
    return this.service.recordUsage(
      principal,
      parse(UsageCommand, body, 'Invalid usage evidence.'),
    );
  }
  @ContractRoute(apiContract.controlPlane.artifact)
  artifact(
    @CurrentPrincipal() principal: Principal,
    @Body() body: ArtifactCommand,
  ): Promise<
    ServerInferResponseBody<typeof apiContract.controlPlane.artifact, 201>
  > {
    return this.service.registerArtifact(
      principal,
      parse(ArtifactCommand, body, 'Invalid artifact metadata.'),
    );
  }

  @ContractRoute(apiContract.controlPlane.registerRunner)
  runner(
    @CurrentPrincipal() principal: Principal,
    @Body() body: RunnerRegistration,
  ): Promise<
    ServerInferResponseBody<typeof apiContract.controlPlane.registerRunner, 201>
  > {
    return this.service.registerRunner(
      principal,
      parse(RunnerRegistration, body, 'Invalid runner registration.'),
    );
  }

  @ContractRoute(apiContract.controlPlane.inbox)
  inbox(
    @CurrentPrincipal() principal: Principal,
    @Param('consumer') consumer: string,
    @Param('eventId') eventId: string,
  ): Promise<
    ServerInferResponseBody<typeof apiContract.controlPlane.inbox, 201>
  > {
    return this.service.recordInbox(principal, consumer, eventId);
  }

  @ContractRoute(apiContract.controlPlane.audit)
  audit(
    @CurrentPrincipal() principal: Principal,
    @Query('application_id') applicationId?: string,
  ): Promise<
    ServerInferResponseBody<typeof apiContract.controlPlane.audit, 200>
  > {
    return this.service.readAudit(principal, applicationId);
  }

  @ContractRoute(apiContract.controlPlane.outbox)
  outbox(
    @CurrentPrincipal() principal: Principal,
  ): Promise<
    ServerInferResponseBody<typeof apiContract.controlPlane.outbox, 200>
  > {
    return this.service.readOutbox(principal);
  }
}
