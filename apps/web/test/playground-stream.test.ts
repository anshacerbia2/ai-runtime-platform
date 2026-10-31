import test from 'node:test';
import assert from 'node:assert/strict';
import { takeSseFrames } from '../src/features/playground/sse';
import {
  chatRequestBody,
  streamChat,
  type ChatStreamUpdate,
} from '../src/features/playground/chat-stream';
import { ApiClientError } from '../src/shared/api/http-error';

const executionId = '7f0c2c1e-1d2b-4c3a-9a8b-0e1f2a3b4c5d';

function frame(sequence: number, type: string, payload: object) {
  const event = {
    schema_version: '1',
    id: `${executionId}:${sequence}`,
    execution_id: executionId,
    sequence,
    type,
    occurred_at: '2026-11-01T03:00:00.000Z',
    payload,
  };
  return `id: ${event.id}\nevent: ${type}\ndata: ${JSON.stringify(event)}\n\n`;
}

function streamOf(chunks: string[]) {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

const request = {
  profile: 'playground-chat',
  system: '',
  messages: [{ role: 'user' as const, text: 'hello' }],
  maxOutputTokens: 64,
  signal: new AbortController().signal,
};

test('SSE frames split across chunks are reassembled; partial tail is kept', () => {
  const first = takeSseFrames('id: 1\nevent: a\ndata: {"x"');
  assert.deepEqual(first.frames, []);
  const second = takeSseFrames(first.rest + ':1}\n\n: comment\n\ndata: tail');
  assert.deepEqual(second.frames, [{ id: '1', event: 'a', data: '{"x":1}' }]);
  assert.equal(second.rest, 'data: tail');
  assert.deepEqual(takeSseFrames('data: a\r\ndata: b\r\n\r\n').frames, [
    { id: null, event: null, data: 'a\nb' },
  ]);
});

test('chat body carries the system prompt first and drops empty turns', () => {
  const body = chatRequestBody({
    ...request,
    system: '  Be brief. ',
    messages: [
      { role: 'user', text: 'hi' },
      { role: 'assistant', text: '' },
    ],
  });
  assert.equal(body.stream, true);
  assert.deepEqual(
    body.input.messages.map((message) => [
      message.role,
      message.content[0].text,
    ]),
    [
      ['system', 'Be brief.'],
      ['user', 'hi'],
    ],
  );
});

test('a streamed execution yields started, deltas, usage and completion', async () => {
  const sent: RequestInit[] = [];
  const updates: ChatStreamUpdate[] = [];
  const body = [
    frame(0, 'execution.started', { provider: 'direct-anthropic', model: 'm' }),
    frame(1, 'model.delta', { text: 'Hel' }),
    frame(2, 'model.delta', { text: 'lo' }),
    frame(3, 'usage.updated', { input_tokens: 5, output_tokens: null }),
    frame(4, 'execution.completed', { finish_reason: 'end_turn' }),
  ].join('');
  await streamChat(
    request,
    (update) => updates.push(update),
    async (_url, init) => {
      sent.push(init ?? {});
      return new Response(streamOf([body.slice(0, 50), body.slice(50)]), {
        headers: { 'Content-Type': 'text/event-stream' },
      });
    },
  );
  const headers = new Headers(sent[0].headers);
  assert.equal(headers.get('accept'), 'text/event-stream');
  assert.match(headers.get('idempotency-key') ?? '', /^playground-/);
  assert.deepEqual(updates, [
    {
      kind: 'started',
      executionId,
      provider: 'direct-anthropic',
      model: 'm',
    },
    { kind: 'delta', text: 'Hel' },
    { kind: 'delta', text: 'lo' },
    // Unknown usage stays null, never zero.
    { kind: 'usage', inputTokens: 5, outputTokens: null },
    { kind: 'completed', finishReason: 'end_turn' },
  ]);
});

test('a rejected request surfaces the gateway error code and message', async () => {
  await assert.rejects(
    streamChat(
      request,
      () => undefined,
      async () =>
        new Response(
          JSON.stringify({
            error: { code: 'NOT_FOUND', message: 'Profile is not available.' },
          }),
          { status: 404, headers: { 'Content-Type': 'application/json' } },
        ),
    ),
    (error: unknown) =>
      error instanceof ApiClientError &&
      error.code === 'NOT_FOUND' &&
      error.serverMessage === 'Profile is not available.',
  );
});
