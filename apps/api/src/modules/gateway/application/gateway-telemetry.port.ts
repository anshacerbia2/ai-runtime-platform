export const GATEWAY_TELEMETRY = Symbol('GatewayTelemetry');

export interface TraceLink {
  traceId: string;
  spanId: string;
  traceFlags: number;
}

export interface AdmissionTraceDetails {
  capability: 'chat' | 'generate' | 'structured_generate';
  streaming: boolean;
}

export interface ProviderTraceDetails {
  executionId: string;
  capability: 'chat' | 'generate' | 'structured_generate';
  provider: string;
  model: string;
  fallback: boolean;
}

export interface GatewayTelemetry {
  admission<T>(
    details: AdmissionTraceDetails,
    work: () => Promise<T>,
  ): Promise<{ value: T; link?: TraceLink }>;

  provider<T>(
    details: ProviderTraceDetails,
    link: TraceLink | undefined,
    work: () => Promise<T>,
  ): Promise<T>;
}

export const noopGatewayTelemetry: GatewayTelemetry = {
  async admission(_details, work) {
    return { value: await work() };
  },
  async provider(_details, _link, work) {
    return work();
  },
};
