import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Span } from '@opentelemetry/api';
import {
  apiTracer,
  context,
  extractRequestContext,
  finishSpan,
  initializeApiTelemetry,
  SpanKind,
  trace,
} from './telemetry.js';
import type { RuntimeConfig } from '../config/environment-config.js';

interface ActiveRequestSpan {
  span: Span;
  ended: boolean;
}

const spans = new WeakMap<FastifyRequest, ActiveRequestSpan>();

function routeTemplate(request: FastifyRequest) {
  return request.routeOptions?.url ?? 'unmatched';
}
function finish(
  request: FastifyRequest,
  reply: FastifyReply,
  outcome: 'ok' | 'error',
  errorType?: string,
) {
  const state = spans.get(request);
  if (!state || state.ended) {
    return;
  }
  state.ended = true;
  state.span.setAttribute('http.response.status_code', reply.statusCode);
  finishSpan(state.span, outcome, errorType);
}

export function registerHttpTelemetry(
  instance: FastifyInstance,
  config: RuntimeConfig,
) {
  initializeApiTelemetry(config.telemetry.tracesEndpoint);

  instance.addHook('onRequest', (request, reply, done) => {
    const parent = extractRequestContext(request.headers);
    const span = apiTracer().startSpan(
      'api.request',
      {
        kind: SpanKind.SERVER,
        attributes: {
          'http.request.method': request.method,
          'http.route': routeTemplate(request),
        },
      },
      parent,
    );
    spans.set(request, { span, ended: false });
    const flushHeaders = reply.raw.flushHeaders.bind(reply.raw);
    reply.raw.flushHeaders = () => {
      // Hijacked SSE bypasses Fastify onSend; end the bounded ingress span
      // when headers become durable instead of holding it for the stream life.
      finish(
        request,
        reply,
        reply.statusCode >= 500 ? 'error' : 'ok',
        reply.statusCode >= 500 ? 'HTTP_5XX' : undefined,
      );
      return flushHeaders();
    };
    const active = trace.setSpan(parent, span);
    context.with(active, done);
  });

  instance.addHook('onSend', (request, reply, payload, done) => {
    finish(
      request,
      reply,
      reply.statusCode >= 500 ? 'error' : 'ok',
      reply.statusCode >= 500 ? 'HTTP_5XX' : undefined,
    );
    done(null, payload);
  });

  instance.addHook('onError', (request, reply, error, done) => {
    finish(request, reply, 'error', error.name || 'Error');
    done();
  });
}
