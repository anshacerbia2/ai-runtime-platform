import 'server-only';
import {
  context,
  propagation,
  SpanKind,
  SpanStatusCode,
  trace,
  type Context,
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

export function initializeWebTelemetry(endpoint?: string) {
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
      'service.name': 'ai-runtime-web',
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
    serviceName: 'ai-runtime-web',
    provider,
  };
  return provider;
}

export function webTracer() {
  return trace.getTracer('ai-runtime-web', '0.3.0-m0');
}

const headersGetter: TextMapGetter<Headers> = {
  keys: (carrier) => Array.from(carrier.keys()),
  get: (carrier, key) => carrier.get(key) ?? undefined,
};
const headersSetter: TextMapSetter<Headers> = {
  set: (carrier, key, value) => carrier.set(key, value),
};

export function extractWebRequestContext(headers: Headers): Context {
  return propagation.extract(context.active(), headers, headersGetter);
}

export function injectActiveTraceHeaders(headers: Headers) {
  propagation.inject(context.active(), headers, headersSetter);
}

export async function traceApiForward<T>(
  requestHeaders: Headers,
  upstreamHeaders: Headers,
  method: string,
  route: string,
  work: () => Promise<T>,
): Promise<T> {
  const parent = extractWebRequestContext(requestHeaders);
  return webTracer().startActiveSpan(
    'bff.api.forward',
    {
      kind: SpanKind.CLIENT,
      attributes: {
        'http.request.method': method,
        'http.route': route,
      },
    },
    parent,
    async (span) => {
      injectActiveTraceHeaders(upstreamHeaders);
      try {
        const result = await work();
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (error) {
        span.setAttribute(
          'error.type',
          error instanceof Error ? error.name.slice(0, 128) : 'unknown',
        );
        span.setStatus({ code: SpanStatusCode.ERROR });
        throw error;
      } finally {
        span.end();
      }
    },
  );
}
