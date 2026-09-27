import { SpanKind, type SpanContext } from '@opentelemetry/api';
import {
  apiTracer,
  finishSpan,
} from '../../../infrastructure/telemetry/telemetry.js';
import type {
  AdmissionTraceDetails,
  GatewayTelemetry,
  ProviderTraceDetails,
  TraceLink,
} from '../application/gateway-telemetry.port.js';

function errorType(error: unknown) {
  return error instanceof Error ? error.name.slice(0, 128) : 'unknown';
}

function asSpanContext(link: TraceLink): SpanContext {
  return {
    traceId: link.traceId,
    spanId: link.spanId,
    traceFlags: link.traceFlags,
    isRemote: false,
  };
}

export class OpenTelemetryGatewayTelemetry implements GatewayTelemetry {
  async admission<T>(
    details: AdmissionTraceDetails,
    work: () => Promise<T>,
  ): Promise<{ value: T; link?: TraceLink }> {
    return apiTracer().startActiveSpan(
      'gateway.admission',
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          'ai.capability': details.capability,
          'ai.streaming': details.streaming,
        },
      },
      async (span) => {
        try {
          const value = await work();
          const spanContext = span.spanContext();
          const link = spanContext.traceId
            ? {
                traceId: spanContext.traceId,
                spanId: spanContext.spanId,
                traceFlags: spanContext.traceFlags,
              }
            : undefined;
          finishSpan(span, 'ok');
          return { value, link };
        } catch (error) {
          finishSpan(span, 'error', errorType(error));
          throw error;
        }
      },
    );
  }

  async provider<T>(
    details: ProviderTraceDetails,
    link: TraceLink | undefined,
    work: () => Promise<T>,
  ): Promise<T> {
    return apiTracer().startActiveSpan(
      'gateway.provider.invoke',
      {
        kind: SpanKind.CLIENT,
        attributes: {
          'ai.execution.id': details.executionId,
          'ai.capability': details.capability,
          'ai.provider': details.provider,
          'ai.model': details.model,
          'ai.fallback': details.fallback,
        },
        links: link ? [{ context: asSpanContext(link) }] : [],
      },
      async (span) => {
        try {
          const value = await work();
          finishSpan(span, 'ok');
          return value;
        } catch (error) {
          finishSpan(span, 'error', errorType(error));
          throw error;
        }
      },
    );
  }
}
