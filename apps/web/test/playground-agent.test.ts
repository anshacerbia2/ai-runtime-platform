import test from 'node:test';
import assert from 'node:assert/strict';
import {
  browserContract,
  type AgentRunEvent,
} from '@ai-runtime/contracts/http';
import {
  agentRequestBody,
  applyAgentEvent,
  streamAgentRun,
  type AgentStep,
} from '../src/features/playground/agent-stream';
import { ApiClientError } from '../src/shared/api/http-error';

const runId = '0b8a4c1e-2d3f-4a5b-8c9d-0e1f2a3b4c5d';
const executionId = '7f0c2c1e-1d2b-4c3a-9a8b-0e1f2a3b4c5d';

function frame(sequence: number, type: string, payload: object) {
  const event = {
    schema_version: '1',
    run_id: runId,
    sequence,
    type,
    occurred_at: '2026-11-01T03:00:00.000Z',
    payload,
  };
  return `id: ${runId}:${sequence}\nevent: ${type}\ndata: ${JSON.stringify(event)}\n\n`;
}

function sse(body: BodyInit) {
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream; charset=utf-8' },
  });
}

const input = {
  profile: 'playground-chat',
  input: 'What is 17 * 23?',
  system: '  ',
  history: [
    { role: 'user' as const, text: 'hi' },
    { role: 'assistant' as const, text: '' },
  ],
  tools: ['calculate' as const],
  maxSteps: 4,
  maxOutputTokens: 512,
};

test('the agent request matches the shared contract and drops blank turns', () => {
  const body = agentRequestBody(input);
  assert.deepEqual(body, {
    profile: 'playground-chat',
    input: 'What is 17 * 23?',
    history: [{ role: 'user', text: 'hi' }],
    tools: ['calculate'],
    max_steps: 4,
    max_output_tokens: 512,
  });
});

test('a streamed run yields typed events, split across chunks, and folds into steps', async () => {
  const body = [
    frame(0, 'run.started', {
      profile: 'playground-chat',
      tools: ['calculate'],
      max_steps: 4,
      token_budget: 50000,
    }),
    frame(1, 'model.dispatched', { step: 1, execution_id: executionId }),
    frame(2, 'model.completed', {
      step: 1,
      execution_id: executionId,
      input_tokens: 100,
      output_tokens: 20,
      thought: 'Multiply exactly.',
      action: 'tool',
    }),
    frame(3, 'tool.called', {
      step: 1,
      tool: 'calculate',
      arguments: { expression: '17*23' },
    }),
    frame(4, 'tool.completed', {
      step: 1,
      tool: 'calculate',
      status: 'SUCCEEDED',
      output: '{"result":391}',
    }),
    'data: not json\n\n',
    frame(5, 'run.completed', {
      answer: '391',
      steps: 2,
      input_tokens: 220,
      output_tokens: 30,
    }),
  ].join('');
  const calls: { url: string; init: RequestInit }[] = [];
  const events: AgentRunEvent[] = [];
  await streamAgentRun(
    { ...input, signal: new AbortController().signal },
    (event) => events.push(event),
    (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      const split = Math.floor(body.length / 3);
      const encoder = new TextEncoder();
      return Promise.resolve(
        sse(
          // Deliberately split mid-frame.
          new ReadableStream({
            start(controller) {
              controller.enqueue(encoder.encode(body.slice(0, split)));
              controller.enqueue(encoder.encode(body.slice(split)));
              controller.close();
            },
          }),
        ),
      );
    },
  );
  assert.equal(calls[0]?.url, browserContract.agent.run.path);
  assert.equal(
    new Headers(calls[0]?.init.headers).get('accept'),
    'text/event-stream',
  );
  assert.deepEqual(
    events.map((event) => event.type),
    [
      'run.started',
      'model.dispatched',
      'model.completed',
      'tool.called',
      'tool.completed',
      'run.completed',
    ],
  );
  const steps = events.reduce<AgentStep[]>(applyAgentEvent, []);
  assert.deepEqual(steps, [
    {
      step: 1,
      executionId,
      thought: 'Multiply exactly.',
      inputTokens: 100,
      outputTokens: 20,
      tool: 'calculate',
      arguments: { expression: '17*23' },
      toolStatus: 'SUCCEEDED',
      toolOutput: '{"result":391}',
    },
  ]);
});

test('a rejected run surfaces the server error code', async () => {
  await assert.rejects(
    streamAgentRun(
      { ...input, signal: new AbortController().signal },
      () => undefined,
      () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              error: { code: 'POLICY_DENIED', message: 'Not allowed.' },
            }),
            { status: 403, headers: { 'content-type': 'application/json' } },
          ),
        ),
    ),
    (error) =>
      error instanceof ApiClientError &&
      error.code === 'POLICY_DENIED' &&
      error.status === 403,
  );
});
