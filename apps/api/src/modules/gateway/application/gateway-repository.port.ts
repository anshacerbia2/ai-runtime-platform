import type {
  GatewayExecution,
  GatewayResult,
  GatewayUsage,
} from '@ai-runtime/contracts/http';
import type { ProviderId } from './provider-adapter.port.js';

export const GATEWAY_REPOSITORY = Symbol('GatewayRepository');

export interface GatewayRoute {
  connectionId: string;
  provider: ProviderId;
  credentialRef: string;
  model: string;
}

export interface GatewayClaim {
  executionId: string;
  attemptId: string;
  invocationId: string;
  applicationId: string;
  capability: 'chat' | 'generate' | 'structured_generate';
  provider: ProviderId;
  credentialRef: string;
  model: string;
  fallback: GatewayRoute | null;
  maxOutputTokens: number;
  timeoutMs: number;
  streaming: boolean;
  inputDigest: string;
}

export type ClaimResult =
  | { state: 'claimed'; claim: GatewayClaim }
  | {
      state: 'terminal';
      execution: GatewayExecution;
      errorCode: string | null;
    };
export interface GatewayRepository {
  claim(
    applicationId: string,
    executionId: string,
    inputDigest: string,
  ): Promise<ClaimResult>;
  beginFallback(claim: GatewayClaim, reason: string): Promise<GatewayClaim>;
  complete(
    claim: GatewayClaim,
    result: GatewayResult,
    usage: GatewayUsage,
    providerRequestId: string | null,
    finishReason: string | null,
  ): Promise<GatewayExecution>;
  fail(
    claim: GatewayClaim,
    code: string,
    ambiguous: boolean,
    cancelled: boolean,
    usage?: GatewayUsage,
    providerRequestId?: string | null,
    providerCompleted?: boolean,
  ): Promise<void>;
  read(
    applicationId: string,
    executionId: string,
    replayed?: boolean,
  ): Promise<GatewayExecution>;
}
