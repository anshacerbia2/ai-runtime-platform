import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { context, trace } from '@opentelemetry/api';
import { loadConfig } from '../../src/infrastructure/config/environment-config.js';
import { registerHttpTelemetry } from '../../src/infrastructure/telemetry/http-telemetry.js';

test('Fastify server telemetry extracts W3C traceparent into handler context', async () => {
  const app = Fastify();
  registerHttpTelemetry(app, loadConfig());
  app.get('/trace-context', async () => ({
    traceId: trace.getSpanContext(context.active())?.traceId ?? null,
  }));
  await app.ready();

  try {
    const incoming = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
    const response = await app.inject({
      method: 'GET',
      url: '/trace-context',
      headers: { traceparent: incoming },
    });
    assert.equal(response.statusCode, 200);
    assert.equal(
      response.json<{ traceId: string | null }>().traceId,
      '4bf92f3577b34da6a3ce929d0e0e4736',
    );
  } finally {
    await app.close();
  }
});
