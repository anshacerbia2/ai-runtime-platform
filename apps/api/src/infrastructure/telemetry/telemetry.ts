import {
  context,
  propagation,
  SpanKind,
  SpanStatusCode,
  trace,
  type Context,
  type Span,
  type TextMapGetter,
  type TextMapSetter,
} from '@opentelemetry/api';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';

const TELEMETRY_STATE = Symbol.for('ai-runtime-platform.telemetry-state');

interface TelemetryState {
  serviceName: string;
  provider: NodeTracerProvider;
}

const globalTelemetry = globalThis as typeof globalThis & {
  [TELEMETRY_STATE]?: TelemetryState;
};
function validatedEndpoint(value?: string) {
  if (!value) {
    return undefined;
  }
  const parsed = new URL(value);
  if (
    !['http:', 'https:'].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    parsed.hash ||
    parsed.search
  ) {
    throw new Error(
      'OTEL_EXPORTER_OTLP_TRACES_ENDPOINT must be an exact HTTP(S) URL without credentials/query/fragment.',
    );
  }
  return value;
}

export function initializeApiTelemetry(endpoint?: string) {
  if (globalTelemetry[TELEMETRY_STATE]) {
    return globalTelemetry[TELEMETRY_STATE]!.provider;
  }
  const tracesEndpoint = validatedEndpoint(endpoint);
  const processors = tracesEndpoint
    ? [
        new BatchSpanProcessor(
          new OTLPTraceExporter({
            url: tracesEndpoint,
            headers: {},
            timeoutMillis: 5000,
          }),
          {
            maxQueueSize: 512,
            maxExportBatchSize: 128,
            scheduledDelayMillis: 2000,
            exportTimeoutMillis: 5000,
          },
        ),
      ]
    : [];
  const provider = new NodeTracerProvider({
    resource: resourceFromAttributes({
      'service.name': 'ai-runtime-api',
      'service.namespace': 'ai-runtime-platform',
    }),
    spanProcessors: processors,
    spanLimits: {
      attributeCountLimit: 24,
      attributeValueLengthLimit: 256,
      eventCountLimit: 8,
      linkCountLimit: 8,
      attributePerEventCountLimit: 8,
      attributePerLinkCountLimit: 4,
    },
  });
  provider.register({ propagator: new W3CTraceContextPropagator() });
  globalTelemetry[TELEMETRY_STATE] = {
    serviceName: 'ai-runtime-api',
    provider,
  };
  return provider;
}

export function apiTracer() {
  return trace.getTracer('ai-runtime-api', '0.3.0-m0');
}

const recordHeaderGetter: TextMapGetter<
  Record<string, string | string[] | undefined>
> = {
  keys: (carrier) => Object.keys(carrier),
  get: (carrier, key) => carrier[key.toLowerCase()],
};
const headersSetter: TextMapSetter<Headers> = {
  set: (carrier, key, value) => carrier.set(key, value),
};

export function extractRequestContext(
  headers: Record<string, string | string[] | undefined>,
): Context {
  return propagation.extract(context.active(), headers, recordHeaderGetter);
}

export function injectActiveTraceHeaders(headers: Headers) {
  propagation.inject(context.active(), headers, headersSetter);
}

export function finishSpan(
  span: Span,
  outcome: 'ok' | 'error',
  errorType?: string,
) {
  if (errorType) {
    span.setAttribute('error.type', errorType.slice(0, 128));
  }
  span.setStatus({
    code: outcome === 'ok' ? SpanStatusCode.OK : SpanStatusCode.ERROR,
  });
  span.end();
}

export { context, SpanKind, trace };
