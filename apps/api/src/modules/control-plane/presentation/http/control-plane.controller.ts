import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
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
@Controller('api/m1')
export class ControlPlaneController {
  constructor(private readonly service: M1ControlPlaneService) {}

  @Get('control-plane')
  read(@CurrentPrincipal() principal: Principal) {
    return this.service.readSnapshot(principal);
  }

  @Put('control-plane')
  manage(@CurrentPrincipal() principal: Principal, @Body() body: unknown) {
    return this.service.manage(
      principal,
      parse(ManagementCommand, body, 'Invalid management command.'),
    );
  }

  @Post('admissions')
  async admit(
    @CurrentPrincipal() principal: Principal,
    @Headers('idempotency-key') key: string | undefined,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: FastifyReply,
  ) {
    const result = await this.service.admit(
      principal,
      parse(AdmissionCommand, body, 'Invalid admission command.'),
      typeof key === 'string' ? key : '',
    );
    response.code(result.replayed ? 200 : 201);
    return result;
  }
  @Get('executions/:id')
  execution(@CurrentPrincipal() principal: Principal, @Param('id') id: string) {
    return this.service.readExecution(principal, id);
  }

  @Post('executions/:id/cancel')
  cancel(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const reason =
      typeof body === 'object' &&
      body !== null &&
      'reason' in body &&
      typeof (body as { reason?: unknown }).reason === 'string'
        ? (body as { reason: string }).reason
        : null;
    return this.service.cancelExecution(principal, id, reason);
  }

  @Post('usage')
  usage(@CurrentPrincipal() principal: Principal, @Body() body: unknown) {
    return this.service.recordUsage(
      principal,
      parse(UsageCommand, body, 'Invalid usage evidence.'),
    );
  }
  @Post('artifacts')
  artifact(@CurrentPrincipal() principal: Principal, @Body() body: unknown) {
    return this.service.registerArtifact(
      principal,
      parse(ArtifactCommand, body, 'Invalid artifact metadata.'),
    );
  }

  @Post('runners/register')
  runner(@CurrentPrincipal() principal: Principal, @Body() body: unknown) {
    return this.service.registerRunner(
      principal,
      parse(RunnerRegistration, body, 'Invalid runner registration.'),
    );
  }

  @Post('inbox/:consumer/:eventId')
  inbox(
    @CurrentPrincipal() principal: Principal,
    @Param('consumer') consumer: string,
    @Param('eventId') eventId: string,
  ) {
    return this.service.recordInbox(principal, consumer, eventId);
  }

  @Get('audit')
  audit(
    @CurrentPrincipal() principal: Principal,
    @Query('application_id') applicationId?: string,
  ) {
    return this.service.readAudit(principal, applicationId);
  }

  @Get('outbox')
  outbox(@CurrentPrincipal() principal: Principal) {
    return this.service.readOutbox(principal);
  }
}
