import type { ProviderId } from './provider-adapter.port.js';

export const GATEWAY_CIRCUIT = Symbol('GatewayCircuit');

export interface CircuitRoute {
  connectionId: string;
  provider: ProviderId;
  model: string;
}

export interface CircuitPermit {
  key: string;
  epoch: string;
  probe: boolean;
  token: string;
}

export type CircuitOutcome = 'success' | 'ambiguous' | 'neutral';

/** A null permit rejects dispatch; reports are best-effort health hints. */
export interface GatewayCircuit {
  acquire(
    route: CircuitRoute,
    timeoutMs: number,
  ): Promise<CircuitPermit | null>;
  report(permit: CircuitPermit, outcome: CircuitOutcome): Promise<void>;
}
