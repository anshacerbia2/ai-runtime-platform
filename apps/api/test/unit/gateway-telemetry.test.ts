import test from 'node:test';
import assert from 'node:assert/strict';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { OpenTelemetryGatewayTelemetry } from '../../src/modules/gateway/infrastructure/opentelemetry-gateway.telemetry.js';

test('gateway telemetry uses bounded phase spans and links provider work to admission', async () => {
  const exporter = new InMemorySpanExporter();
  const provider = new NodeTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
    spanLimits: {
      eventCountLimit: 4,
      linkCountLimit: 4,
      attributeCountLimit: 16,
    },
  });
  provider.register({ propagator: new W3CTraceContextPropagator() });

  const telemetry = new OpenTelemetryGatewayTelemetry();
  const admitted = await telemetry.admission(
    { capability: 'chat', streaming: true },
    async () => 'admitted',
  );
  assert.equal(admitted.value, 'admitted');
  assert.ok(admitted.link);

  const result = await telemetry.provider(
    {
      executionId: '00000000-0000-4000-8000-000000000999',
      capability: 'chat',
      provider: 'openrouter',
      model: 'fixture-model',
      fallback: false,
    },
    admitted.link,
    async () => 42,
  );
  assert.equal(result, 42);

  const spans = exporter.getFinishedSpans();
  const admission = spans.find((span) => span.name === 'gateway.admission');
  const invocation = spans.find(
    (span) => span.name === 'gateway.provider.invoke',
  );
  assert.ok(admission);
  assert.ok(invocation);
  assert.equal(invocation.links.length, 1);
  assert.equal(
    invocation.links[0]!.context.spanId,
    admission.spanContext().spanId,
  );
  assert.equal(invocation.events.length, 0);
  assert.equal(invocation.attributes['ai.provider'], 'openrouter');
  assert.equal(invocation.attributes['ai.fallback'], false);
  for (const key of Object.keys(invocation.attributes)) {
    assert.doesNotMatch(
      key,
      /prompt|output|credential|api[_-]?key|authorization|token\.delta/i,
    );
  }

  await provider.shutdown();
});
