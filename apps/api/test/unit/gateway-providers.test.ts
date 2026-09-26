import assert from 'node:assert/strict';
import test from 'node:test';
import { AnthropicAdapter } from '../../src/modules/gateway/infrastructure/anthropic.adapter.js';
import { OpenRouterAdapter } from '../../src/modules/gateway/infrastructure/openrouter.adapter.js';
import { ProviderError } from '../../src/modules/gateway/application/provider-adapter.port.js';

const request = {
  capability: 'chat' as const,
  model: 'test-model',
  credentialRef: 'env:M2_OPENROUTER_API_KEY',
  messages: [{ role: 'user' as const, text: 'hello' }],
  maxOutputTokens: 64,
  timeoutMs: 1000,
};

function sseResponse(frames: string) {
  const bytes = new TextEncoder().encode(frames);
  const split = Math.max(1, Math.floor(bytes.length / 3));
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, split));
        controller.enqueue(bytes.slice(split, split * 2));
        controller.enqueue(bytes.slice(split * 2));
        controller.close();
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  );
}
test('OpenRouter adapter maps bounded SSE text and usage', async () => {
  let calls = 0;
  const adapter = new OpenRouterAdapter(
    'secret',
    async (_url, init) => {
      calls++;
      assert.equal(
        new Headers(init?.headers).get('authorization'),
        'Bearer secret',
      );
      const payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
      assert.equal(payload.model, 'test-model');
      return sseResponse(
        'data: {"id":"or-1","choices":[{"delta":{"content":"Hi "}}]}\n\n' +
          'data: {"id":"or-1","choices":[{"delta":{"content":"there"},"finish_reason":"stop"}]}\n\n' +
          'data: {"id":"or-1","choices":[],"usage":{"prompt_tokens":4,"completion_tokens":2}}\n\n' +
          'data: [DONE]\n\n',
      );
    },
    'http://provider.test/openrouter',
  );
  const events = [];
  for await (const event of adapter.stream(
    request,
    new AbortController().signal,
  )) {
    events.push(event);
  }
  assert.equal(calls, 1);
  assert.deepEqual(events, [
    { type: 'started', requestId: 'or-1' },
    { type: 'delta', text: 'Hi ' },
    { type: 'delta', text: 'there' },
    { type: 'usage', inputTokens: 4, outputTokens: 2 },
    { type: 'done', requestId: 'or-1', finishReason: 'stop' },
  ]);
});
test('OpenRouter refuses a credential reference owned by another binding', async () => {
  const adapter = new OpenRouterAdapter('secret', async () => {
    throw new Error('transport must not be called');
  });
  await assert.rejects(
    async () => {
      for await (const _event of adapter.stream(
        { ...request, credentialRef: 'vault:other-app' },
        new AbortController().signal,
      )) {
        // no-op
      }
    },
    (error: unknown) =>
      error instanceof ProviderError &&
      error.code === 'PROVIDER_CREDENTIAL_REF_UNSUPPORTED' &&
      error.outcome === 'not-sent',
  );
});

test('Anthropic adapter maps message lifecycle and cumulative usage', async () => {
  const adapter = new AnthropicAdapter(
    'anthropic-secret',
    async (_url, init) => {
      assert.equal(
        new Headers(init?.headers).get('x-api-key'),
        'anthropic-secret',
      );
      return sseResponse(
        'event: message_start\n' +
          'data: {"type":"message_start","message":{"id":"msg-1","usage":{"input_tokens":5}}}\n\n' +
          'event: content_block_delta\n' +
          'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}}\n\n' +
          'event: message_delta\n' +
          'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":3}}\n\n' +
          'event: message_stop\n' +
          'data: {"type":"message_stop"}\n\n',
      );
    },
    'http://provider.test/anthropic',
  );
  const events = [];
  for await (const event of adapter.stream(
    { ...request, credentialRef: 'env:M2_ANTHROPIC_API_KEY' },
    new AbortController().signal,
  )) {
    events.push(event);
  }
  assert.deepEqual(events, [
    { type: 'started', requestId: 'msg-1' },
    { type: 'delta', text: 'Hello' },
    { type: 'usage', inputTokens: 5, outputTokens: 3 },
    { type: 'done', requestId: 'msg-1', finishReason: 'end_turn' },
  ]);
});
test('provider transport failure is ambiguous and never blindly retried', async () => {
  let calls = 0;
  const adapter = new OpenRouterAdapter(
    'secret',
    async () => {
      calls++;
      throw new TypeError('socket reset');
    },
    'http://provider.test/openrouter',
  );
  await assert.rejects(
    async () => {
      for await (const _event of adapter.stream(
        request,
        new AbortController().signal,
      )) {
        // no-op
      }
    },
    (error: unknown) =>
      error instanceof ProviderError &&
      error.code === 'OPENROUTER_TRANSPORT_ERROR' &&
      error.outcome === 'unknown',
  );
  assert.equal(calls, 1);
});
