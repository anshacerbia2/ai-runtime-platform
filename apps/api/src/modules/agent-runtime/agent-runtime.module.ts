import { Module } from '@nestjs/common';
import { GatewayModule } from '../gateway/gateway.module.js';
import { GatewayService } from '../gateway/application/gateway.service.js';
import {
  AGENT_CAPABILITIES,
  type AgentCapabilities,
} from './application/agent-capabilities.port.js';
import { RunAgentUseCase } from './application/run-agent.use-case.js';
import { GatewayAgentCapabilities } from './infrastructure/gateway-agent-capabilities.js';
import { AgentRunsController } from './presentation/http/agent-runs.controller.js';

// ADR-0034 stage A2-preview: request-scoped agent runs over the gateway
// application boundary. No tables, no durable run, no provider adapter access.
@Module({
  imports: [GatewayModule],
  controllers: [AgentRunsController],
  providers: [
    {
      provide: AGENT_CAPABILITIES,
      inject: [GatewayService],
      useFactory: (gateway: GatewayService) =>
        new GatewayAgentCapabilities(gateway),
    },
    {
      provide: RunAgentUseCase,
      inject: [AGENT_CAPABILITIES],
      useFactory: (capabilities: AgentCapabilities) =>
        new RunAgentUseCase(capabilities),
    },
  ],
})
export class AgentRuntimeModule {}
