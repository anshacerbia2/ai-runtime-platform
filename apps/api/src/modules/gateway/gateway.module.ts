import { randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module.js';
import { DatabaseService } from '../../infrastructure/database/database.service.js';
import { RUNTIME_CONFIG } from '../../infrastructure/config/runtime-config.module.js';
import type { RuntimeConfig } from '../../infrastructure/config/environment-config.js';
import { ControlPlaneModule } from '../control-plane/control-plane.module.js';
import {
  M1_REPOSITORY,
  type M1Repository,
} from '../control-plane/application/m1-repository.port.js';
import { M1ControlPlaneService } from '../control-plane/application/m1-control-plane.service.js';
import {
  GATEWAY_REPOSITORY,
  type GatewayRepository,
} from './application/gateway-repository.port.js';
import {
  GATEWAY_CONTROL,
  type GatewayControl,
} from './application/gateway-control.port.js';
import {
  REPLAY_STORE,
  type ReplayStore,
} from './application/replay-store.port.js';
import {
  REQUEST_FINGERPRINT,
  type RequestFingerprint,
} from './application/request-fingerprint.port.js';
import {
  STRUCTURED_OUTPUT,
  type StructuredOutputValidator,
} from './application/structured-output.port.js';
import type { ProviderAdapter } from './application/provider-adapter.port.js';
import {
  GATEWAY_TELEMETRY,
  type GatewayTelemetry,
} from './application/gateway-telemetry.port.js';
import {
  GATEWAY_CANCEL_SIGNAL,
  noopGatewayCancelSignal,
  type GatewayCancelSignal,
} from './application/gateway-cancel-signal.port.js';
import { GatewayService } from './application/gateway.service.js';
import { PrismaGatewayRepository } from './infrastructure/prisma-gateway.repository.js';
import { ControlPlaneGatewayAdapter } from './infrastructure/control-plane-gateway.adapter.js';
import { InMemoryReplayStore } from './infrastructure/in-memory-replay.store.js';
import { RedisReplayStore } from './infrastructure/redis-replay.store.js';
import { RedisGatewayCancelSignal } from './infrastructure/redis-gateway-cancel.signal.js';
import { Sha256RequestFingerprint } from './infrastructure/sha256-request-fingerprint.js';
import { BoundedStructuredOutputValidator } from './infrastructure/structured-output.validator.js';
import { OpenRouterAdapter } from './infrastructure/openrouter.adapter.js';
import { AnthropicAdapter } from './infrastructure/anthropic.adapter.js';
import { OpenTelemetryGatewayTelemetry } from './infrastructure/opentelemetry-gateway.telemetry.js';
import { GatewayController } from './presentation/http/gateway.controller.js';

const OPENROUTER = Symbol('OpenRouterProvider');
const ANTHROPIC = Symbol('AnthropicProvider');
const OWNER_INSTANCE_ID = randomUUID();

@Module({
  imports: [DatabaseModule, ControlPlaneModule],
  controllers: [GatewayController],
  providers: [
    {
      provide: GATEWAY_REPOSITORY,
      inject: [DatabaseService],
      useFactory: (db: DatabaseService) => new PrismaGatewayRepository(db),
    },
    {
      provide: GATEWAY_CONTROL,
      inject: [M1ControlPlaneService, M1_REPOSITORY],
      useFactory: (control: M1ControlPlaneService, repo: M1Repository) =>
        new ControlPlaneGatewayAdapter(control, repo),
    },
    {
      provide: REPLAY_STORE,
      inject: [RUNTIME_CONFIG],
      useFactory: (config: RuntimeConfig) =>
        config.gateway.replayRedisUrl
          ? RedisReplayStore.connect(config.gateway.replayRedisUrl)
          : new InMemoryReplayStore(),
    },
    {
      provide: GATEWAY_CANCEL_SIGNAL,
      inject: [RUNTIME_CONFIG],
      useFactory: (config: RuntimeConfig) =>
        config.gateway.replayRedisUrl
          ? RedisGatewayCancelSignal.connect(config.gateway.replayRedisUrl)
          : noopGatewayCancelSignal,
    },
    { provide: REQUEST_FINGERPRINT, useClass: Sha256RequestFingerprint },
    { provide: STRUCTURED_OUTPUT, useClass: BoundedStructuredOutputValidator },
    { provide: GATEWAY_TELEMETRY, useClass: OpenTelemetryGatewayTelemetry },
    {
      provide: OPENROUTER,
      inject: [RUNTIME_CONFIG],
      useFactory: (config: RuntimeConfig) =>
        new OpenRouterAdapter(
          config.gateway.openrouterApiKey,
          fetch,
          config.gateway.openrouterEndpoint,
        ),
    },
    {
      provide: ANTHROPIC,
      inject: [RUNTIME_CONFIG],
      useFactory: (config: RuntimeConfig) =>
        new AnthropicAdapter(
          config.gateway.anthropicApiKey,
          fetch,
          config.gateway.anthropicEndpoint,
        ),
    },
    {
      provide: GatewayService,
      inject: [
        GATEWAY_CONTROL,
        GATEWAY_REPOSITORY,
        OPENROUTER,
        ANTHROPIC,
        REPLAY_STORE,
        REQUEST_FINGERPRINT,
        STRUCTURED_OUTPUT,
        GATEWAY_TELEMETRY,
        GATEWAY_CANCEL_SIGNAL,
      ],
      useFactory: (
        control: GatewayControl,
        repository: GatewayRepository,
        openrouter: ProviderAdapter,
        anthropic: ProviderAdapter,
        replay: ReplayStore,
        fingerprint: RequestFingerprint,
        structured: StructuredOutputValidator,
        telemetry: GatewayTelemetry,
        cancelSignal: GatewayCancelSignal,
      ) =>
        new GatewayService(
          control,
          repository,
          [openrouter, anthropic],
          replay,
          fingerprint,
          structured,
          OWNER_INSTANCE_ID,
          telemetry,
          cancelSignal,
        ),
    },
  ],
})
export class GatewayModule {}
