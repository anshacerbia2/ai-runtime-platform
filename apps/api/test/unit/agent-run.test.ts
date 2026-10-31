import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Principal } from '../../src/modules/identity/domain/principal.js';
import { parseAgentReply } from '../../src/modules/agent-runtime/domain/agent-protocol.js';
import type {
  AgentCapabilities,
  CallerCapabilities,
} from '../../src/modules/agent-runtime/application/agent-capabilities.port.js';
import type {
  ModelIntent,
  ModelObservation,
} from '../../src/modules/agent-runtime/application/model-execution.port.js';
import type {
  ToolIntent,
  ToolObservation,
} from '../../src/modules/agent-runtime/application/tool-execution.port.js';
import {
  RunAgentUseCase,
  type AgentRunCommand,
  type AgentRunUpdate,
} from '../../src/modules/agent-runtime/application/run-agent.use-case.js';
import { InProcessRunBudget } from '../../src/modules/agent-runtime/infrastructure/in-process-run-budget.js';
import { builtinToolCatalogue } from '../../src/modules/agent-runtime/infrastructure/builtin-tools.js';
import { calculate } from '../../src/modules/agent-runtime/infrastructure/calculator.js';

const principal: Principal = {
  subject: 'app-1',
  kind: 'application',
  applicationId: 'app-1',
  roles: ['runtime-application'],
  scopes: ['execution:submit', 'execution:read', 'execution:cancel'],
};

function command(overrides: Partial<AgentRunCommand> = {}): AgentRunCommand {
  return {
    runId: randomUUID(),
    profile: 'playground-chat',
    input: 'What is 17 * 23?',
    system: null,
    history: [],
    tools: null,
    maxSteps: 4,
    maxOutputTokens: 512,
    tokenBudget: 10_000,
    ...overrides,
  };
}

function harness(
  replies: (ModelObservation | string)[],
  tool: (intent: ToolIntent) => ToolObservation = (intent) => ({
    state: 'SUCCEEDED',
    ref: { operationId: intent.identity.operationId, receiptId: null },
    result: { result: 391 },
  }),
) {
  const intents: ModelIntent[] = [];
  const tools: ToolIntent[] = [];
  const caps: CallerCapabilities = {
    model: {
      execute(intent, options) {
        intents.push(intent);
        const reply = replies.shift() ?? '{"final": "done"}';
        const ref = {
          operationId: intent.identity.operationId,
          inferenceId: randomUUID(),
        };
        options?.onDispatched?.(ref);
        return Promise.resolve(
          typeof reply === 'string'
            ? {
                state: 'SUCCEEDED',
                ref,
                output: reply,
                usage: {
                  inputTokens: 100,
                  outputTokens: 20,
                  charged: null,
                  completeness: 'complete',
                },
              }
            : reply,
        );
      },
      status: (ref) => Promise.resolve({ state: 'UNKNOWN', ref }),
      cancel: () => Promise.resolve(),
    },
    tools: {
      invoke(intent) {
        tools.push(intent);
        return Promise.resolve(tool(intent));
      },
      status: (ref) => Promise.resolve({ state: 'UNKNOWN', ref }),
    },
    budget: new InProcessRunBudget(),
    catalogue: builtinToolCatalogue,
    digest: (value) => JSON.stringify(value).length.toString(16),
  };
  const capabilities: AgentCapabilities = { forCaller: () => caps };
  const updates: AgentRunUpdate[] = [];
  return {
    intents,
    tools,
    updates,
    run: (input: AgentRunCommand, signal = new AbortController().signal) =>
      new RunAgentUseCase(capabilities).run(
        principal,
        input,
        (update) => {
          updates.push(update);
        },
        signal,
      ),
  };
}

test('the agent calls a tool, reads its result, then answers', async () => {
  const h = harness([
    '{"thought": "Multiply exactly.", "tool": "calculate", "arguments": {"expression": "17*23"}}',
    '```json\n{"thought": "Have it.", "final": "17 × 23 = 391."}\n```',
  ]);
  const status = await h.run(command());
  assert.equal(status, 'COMPLETED');
  assert.deepEqual(
    h.updates.map((update) => update.type),
    [
      'run.started',
      'model.dispatched',
      'model.completed',
      'tool.called',
      'tool.completed',
      'model.dispatched',
      'model.completed',
      'run.completed',
    ],
  );
  const done = h.updates.at(-1);
  assert.equal(done?.type, 'run.completed');
  if (done?.type === 'run.completed') {
    assert.equal(done.answer, '17 × 23 = 391.');
    assert.deepEqual(done.totals, {
      steps: 2,
      inputTokens: 200,
      outputTokens: 40,
    });
  }
  // The tool intent carries the pinned binding, not model-chosen authority.
  assert.equal(h.tools[0]?.bindingId, 'builtin:calculate:v1');
  assert.deepEqual(h.tools[0]?.arguments, { expression: '17*23' });
  // The second model turn sees the tool result as a user message.
  const second = h.intents[1]?.messages ?? [];
  assert.match(second.at(-1)?.content ?? '', /Tool result for calculate/);
  assert.equal(second[0]?.role, 'system');
  // Every turn has its own operation identity and allocation.
  assert.notEqual(
    h.intents[0]?.identity.operationId,
    h.intents[1]?.identity.operationId,
  );
  assert.ok(h.intents.every((intent) => intent.allocation.allocationId));
});

test('plain text from the model is a final answer', async () => {
  const h = harness(['Hello! How can I help?']);
  assert.equal(await h.run(command({ input: 'hi' })), 'COMPLETED');
  const done = h.updates.at(-1);
  assert.equal(
    done?.type === 'run.completed' && done.answer,
    'Hello! How can I help?',
  );
});

test('an unknown or unselected tool is reported back to the model, not run', async () => {
  const h = harness([
    '{"tool": "calculate", "arguments": {"expression": "1+1"}}',
    '{"final": "ok"}',
  ]);
  await h.run(command({ tools: ['current_time'] }));
  assert.equal(h.tools.length, 0);
  const result = h.updates.find((update) => update.type === 'tool.completed');
  assert.equal(result?.type === 'tool.completed' && result.status, 'FAILED');
  assert.match(
    result?.type === 'tool.completed' ? result.output : '',
    /Unknown tool "calculate"\. Available: current_time/,
  );
});

test('the step limit forces a final answer and stops a looping agent', async () => {
  const loop = '{"tool": "current_time", "arguments": {}}';
  const h = harness([loop, loop, loop]);
  assert.equal(await h.run(command({ maxSteps: 2 })), 'FAILED');
  const last = h.intents[1]?.messages.at(-1)?.content ?? '';
  assert.match(last, /Step limit reached/);
  const stop = h.updates.at(-1);
  assert.equal(stop?.type === 'run.stopped' && stop.code, 'STEP_LIMIT');
});

test('the run token budget stops the run before another step', async () => {
  const loop = '{"tool": "current_time", "arguments": {}}';
  const h = harness([loop, loop, loop]);
  // Each fake step charges 120 tokens, so 150 leaves less than one step's
  // minimum (64) after the first step.
  const status = await h.run(
    command({ tokenBudget: 150, maxOutputTokens: 64 }),
  );
  assert.equal(status, 'STOPPED_BUDGET');
  assert.equal(h.intents.length, 1);
  const stop = h.updates.at(-1);
  assert.equal(
    stop?.type === 'run.stopped' && stop.code,
    'RUN_TOKEN_BUDGET_EXHAUSTED',
  );
});

test('a refused model step surfaces the gateway code for setup guidance', async () => {
  const h = harness([
    {
      state: 'NO_EFFECT',
      ref: { operationId: 'x', inferenceId: null },
      reason: 'NOT_FOUND: Published profile not found.',
    },
  ]);
  assert.equal(await h.run(command()), 'FAILED');
  const stop = h.updates.at(-1);
  assert.deepEqual(stop?.type === 'run.stopped' && [stop.code, stop.message], [
    'NOT_FOUND',
    'Published profile not found.',
  ]);
  // Nothing reached a model, so no step is counted.
  assert.equal(stop?.type === 'run.stopped' && stop.totals.steps, 0);
});

test('a cancelled run admits no further operation', async () => {
  const controller = new AbortController();
  const h = harness(['{"tool": "current_time", "arguments": {}}'], (intent) => {
    controller.abort();
    return {
      state: 'SUCCEEDED',
      ref: { operationId: intent.identity.operationId, receiptId: null },
      result: 'now',
    };
  });
  assert.equal(await h.run(command(), controller.signal), 'CANCELLED');
  assert.equal(h.intents.length, 1);
});

test('reply parsing tolerates fences and prose, and never invents a tool', () => {
  assert.deepEqual(
    parseAgentReply(
      'Sure: {"tool": "calculate", "arguments": {"expression": "2"}} done',
    ),
    {
      kind: 'tool',
      tool: 'calculate',
      arguments: { expression: '2' },
      thought: null,
    },
  );
  assert.deepEqual(parseAgentReply('{"tool": "x", "arguments": [1]}'), {
    kind: 'tool',
    tool: 'x',
    arguments: {},
    thought: null,
  });
  assert.equal(parseAgentReply('{broken').kind, 'final');
  assert.equal(parseAgentReply('{"note": 1}').kind, 'final');
});

test('the calculator is exact, bounded and refuses unknown names', () => {
  assert.equal(calculate('17*23'), 391);
  assert.equal(calculate('-2^2'), -4);
  assert.equal(calculate('2^3^2'), 512);
  assert.equal(calculate('2^-1'), 0.5);
  assert.equal(calculate('sqrt(16) + abs(-3) * (1 + 1)'), 10);
  assert.equal(calculate('round(pi * 100) / 100'), 3.14);
  assert.throws(() => calculate('1/0'), /Division by zero/);
  assert.throws(() => calculate('constructor(1)'), /Unknown name/);
  assert.throws(() => calculate('process.exit()'), /Unknown name/);
  assert.throws(() => calculate('1+'), /ended unexpectedly/);
  assert.throws(() => calculate('9'.repeat(201)), /longer than 200/);
});
