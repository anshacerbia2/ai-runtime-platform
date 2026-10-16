import { Body, Controller, HttpCode, Inject, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import {
  RunnerPayloadHandoffCommand,
  runnerPayloadHandoffContract,
  type RunnerLeaseCommand,
} from '@ai-runtime/contracts/http';
import { sendBoundedBinary } from '../../../../shared/presentation/bounded-binary-reply.js';
import { ContractRoute } from '../../../../shared/presentation/contract-route.js';
import type { Principal } from '../../../identity/domain/principal.js';
import { requireAuthority } from '../../../identity/domain/principal.js';
import { CurrentPrincipal } from '../../../identity/presentation/http/current-principal.decorator.js';

export const RUNNER_PAYLOAD_HANDOFF = Symbol('RUNNER_PAYLOAD_HANDOFF');
const MAX_PAYLOAD_BYTES = 1_048_576;

export interface RunnerPayloadHandoff {
  read(
    principal: Principal,
    command: RunnerLeaseCommand,
    envelopeId: string,
  ): Promise<Uint8Array>;
}

/** Binary adapter kept out of AppModule until production KMS/storage wiring exists. */
@Controller()
export class RunnerPayloadHandoffController {
  constructor(
    @Inject(RUNNER_PAYLOAD_HANDOFF)
    private readonly delivery: RunnerPayloadHandoff,
  ) {}

  @ContractRoute(runnerPayloadHandoffContract.payload)
  @HttpCode(200)
  async payload(
    @CurrentPrincipal() principal: Principal,
    @Body() body: unknown,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    requireAuthority(principal, 'runner:report');
    const command = RunnerPayloadHandoffCommand.parse(body);
    const { envelopeId, ...leaseCommand } = command;
    const bytes = await this.delivery.read(principal, leaseCommand, envelopeId);
    sendBoundedBinary(reply, bytes, MAX_PAYLOAD_BYTES);
  }
}
