import { Body, Controller, HttpCode, Inject, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import {
  RunnerPayloadHandoffCommand,
  runnerPluginHandoffContract,
  type RunnerLeaseCommand,
} from '@ai-runtime/contracts/http';
import { sendBoundedBinary } from '../../../../shared/presentation/bounded-binary-reply.js';
import { ContractRoute } from '../../../../shared/presentation/contract-route.js';
import type { Principal } from '../../../identity/domain/principal.js';
import { requireAuthority } from '../../../identity/domain/principal.js';
import { CurrentPrincipal } from '../../../identity/presentation/http/current-principal.decorator.js';

export const RUNNER_PLUGIN_HANDOFF = Symbol('RUNNER_PLUGIN_HANDOFF');
const MAX_PLUGIN_BYTES = 16_777_216;

export interface RunnerPluginHandoff {
  read(
    principal: Principal,
    command: RunnerLeaseCommand,
    envelopeId: string,
  ): Promise<Uint8Array>;
}

/** Verified package adapter kept out of AppModule pending signer trust wiring. */
@Controller()
export class RunnerPluginHandoffController {
  constructor(
    @Inject(RUNNER_PLUGIN_HANDOFF)
    private readonly delivery: RunnerPluginHandoff,
  ) {}

  @ContractRoute(runnerPluginHandoffContract.plugin)
  @HttpCode(200)
  async plugin(
    @CurrentPrincipal() principal: Principal,
    @Body() body: unknown,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    requireAuthority(principal, 'runner:report');
    const command = RunnerPayloadHandoffCommand.parse(body);
    const { envelopeId, ...leaseCommand } = command;
    const bytes = await this.delivery.read(principal, leaseCommand, envelopeId);
    sendBoundedBinary(reply, bytes, MAX_PLUGIN_BYTES);
  }
}
