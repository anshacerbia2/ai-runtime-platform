import type { Principal } from '../../identity/domain/principal.js';
import type { GatewayClaim } from './gateway-repository.port.js';

export const GATEWAY_CONTROL = Symbol('GatewayControl');

export interface AdmissionView {
  execution: {
    id: string;
    status: string;
  };
  replayed: boolean;
}

export interface GatewayControl {
  admit(
    principal: Principal,
    profileRef: string,
    inputDigest: string,
    idempotencyKey: string,
  ): Promise<AdmissionView>;
  cancel(
    principal: Principal,
    executionId: string,
    reason: string | null,
  ): Promise<void>;
  recordUsage(
    claim: GatewayClaim,
    providerRequestId: string | null,
    inputTokens: number | null,
    outputTokens: number | null,
  ): Promise<void>;
}
