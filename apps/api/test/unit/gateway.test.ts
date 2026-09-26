import test from 'node:test';
import assert from 'node:assert/strict';
import type { Principal } from '../../src/modules/identity/domain/principal.js';
import { GatewayService } from '../../src/modules/gateway/application/gateway.service.js';
import {
  ProviderError,
  type ProviderAdapter,
  type ProviderRequest,
} from '../../src/modules/gateway/application/provider-adapter.port.js';
import type { GatewayControl } from '../../src/modules/gateway/application/gateway-control.port.js';
import type {
  ClaimResult,
  GatewayClaim,
  GatewayRepository,
} from '../../src/modules/gateway/application/gateway-repository.port.js';
import { InMemoryReplayStore } from '../../src/modules/gateway/infrastructure/in-memory-replay.store.js';
import { Sha256RequestFingerprint } from '../../src/modules/gateway/infrastructure/sha256-request-fingerprint.js';
import { BoundedStructuredOutputValidator } from '../../src/modules/gateway/infrastructure/structured-output.validator.js';
import { OpenRouterAdapter } from '../../src/modules/gateway/infrastructure/openrouter.adapter.js';
import { AnthropicAdapter } from '../../src/modules/gateway/infrastructure/anthropic.adapter.js';
import type {
  GatewayExecution,
  GatewayResult,
  GatewayStreamEvent,
  GatewayUsage,
} from '@ai-runtime/contracts/http';
const executionId = '00000000-0000-4000-8000-000000000201';
const attemptId = '00000000-0000-4000-8000-000000000202';
const invocationId = '00000000-0000-4000-8000-000000000203';

const principal: Principal = {
  subject: 'm2-test-app',
  kind: 'application',
  applicationId: 'm2-test-app',
  roles: ['runtime-application'],
  scopes: ['execution:submit', 'execution:read', 'execution:cancel'],
};

const claim: GatewayClaim = {
  executionId,
  attemptId,
  invocationId,
  applicationId: 'm2-test-app',
  capability: 'chat',
  provider: 'openrouter',
  credentialRef: 'env:M2_OPENROUTER_API_KEY',
  model: 'test-model',
  fallback: null,
  maxOutputTokens: 512,
  timeoutMs: 30000,
  streaming: true,
  inputDigest: 'a'.repeat(64),
};

function execution(
  status: GatewayExecution['status'],
  replayed = false,
): GatewayExecution {
  return {
    executionId,
    status,
    replayed,
    provider: 'openrouter',
    model: 'test-model',
    result: status === 'COMPLETED' ? { kind: 'text', text: 'hello' } : null,
    usage: {
      inputTokens: status === 'COMPLETED' ? 2 : null,
      outputTokens: status === 'COMPLETED' ? 1 : null,
      totalTokens: status === 'COMPLETED' ? 3 : null,
      completeness: status === 'COMPLETED' ? 'complete' : 'unknown',
    },
    requestId: status === 'COMPLETED' ? 'req-1' : null,
    finishReason: status === 'COMPLETED' ? 'stop' : null,
    links: {
      self: '/v1/executions/' + executionId,
      events: '/v1/executions/' + executionId + '/events',
    },
  };
}

class FakeControl implements GatewayControl {
  usageCalls = 0;
  cancelCalls = 0;
  async admit() {
    return {
      execution: { id: executionId, status: 'ACCEPTED' },
      replayed: false,
    };
  }
  async cancel() {
    this.cancelCalls++;
  }
  async recordUsage() {
    this.usageCalls++;
  }
}

class FakeRepository implements GatewayRepository {
  claimResult: ClaimResult = { state: 'claimed', claim };
  failed: Array<{ ambiguous: boolean; cancelled: boolean }> = [];
  completed = 0;
  current = execution('RUNNING');

  async claim() {
    return this.claimResult;
  }
  async beginFallback(current: GatewayClaim) {
    if (!current.fallback) {
      throw new Error('No fallback configured');
    }
    return {
      ...current,
      provider: current.fallback.provider,
      credentialRef: current.fallback.credentialRef,
      model: current.fallback.model,
      fallback: null,
    };
  }
  async complete(
    _claim: GatewayClaim,
    _result: GatewayResult,
    _usage: GatewayUsage,
  ) {
    this.completed++;
    this.current = execution('COMPLETED');
    return this.current;
  }
  async fail(
    _claim: GatewayClaim,
    _code: string,
    ambiguous: boolean,
    cancelled: boolean,
  ) {
    this.failed.push({ ambiguous, cancelled });
    this.current = execution(
      cancelled ? 'CANCELLED' : ambiguous ? 'RECONCILING' : 'FAILED',
    );
  }
  async read() {
    return this.current;
  }
}
const command = {
  profile: 'chat-default@1',
  capability: 'chat' as const,
  stream: false,
  constraints: undefined,
  messages: [{ role: 'user' as const, text: 'hello' }],
  artifactRefs: [],
  fingerprintInput: { messages: ['hello'] },
};

function service(
  provider: ProviderAdapter,
  repository = new FakeRepository(),
  control = new FakeControl(),
) {
  return {
    gateway: new GatewayService(
      control,
      repository,
      [provider],
      new InMemoryReplayStore(),
      new Sha256RequestFingerprint(),
      new BoundedStructuredOutputValidator(),
    ),
    repository,
    control,
  };
}

test('gateway completes one durable provider invocation and records usage', async () => {
  let calls = 0;
  const provider: ProviderAdapter = {
    id: 'openrouter',
    async *stream() {
      calls++;
      yield { type: 'started', requestId: 'req-1' };
      yield { type: 'delta', text: 'hello' };
      yield { type: 'usage', inputTokens: 2, outputTokens: 1 };
      yield { type: 'done', requestId: 'req-1', finishReason: 'stop' };
    },
  };
  const { gateway, repository, control } = service(provider);
  const result = await gateway.execute(principal, command, 'm2-success');

  assert.equal(result.status, 'COMPLETED');
  assert.equal(result.result?.kind, 'text');
  assert.equal(repository.completed, 1);
  assert.equal(repository.failed.length, 0);
  assert.equal(control.usageCalls, 1);
  assert.equal(calls, 1);

  const watch = await gateway.events(principal, executionId);
  assert.deepEqual(
    watch.page.events.map((event) => event.type),
    [
      'execution.started',
      'model.delta',
      'usage.updated',
      'execution.completed',
    ],
  );
});

test('same-key terminal replay never calls the provider twice', async () => {
  let calls = 0;
  const provider: ProviderAdapter = {
    id: 'openrouter',
    async *stream() {
      calls++;
      yield { type: 'done', requestId: null, finishReason: null };
    },
  };
  const repository = new FakeRepository();
  repository.claimResult = {
    state: 'terminal',
    execution: execution('COMPLETED', true),
    errorCode: null,
  };
  const { gateway } = service(provider, repository);
  const result = await gateway.execute(principal, command, 'm2-replay');

  assert.equal(result.replayed, true);
  assert.equal(result.status, 'COMPLETED');
  assert.equal(calls, 0);
});

test('provider ambiguity after start is reconciled rather than fabricated as rollback', async () => {
  const provider: ProviderAdapter = {
    id: 'openrouter',
    async *stream() {
      yield { type: 'started', requestId: 'req-ambiguous' };
      throw new ProviderError('openrouter', 'CONNECTION_LOST', 'unknown');
    },
  };
  const { gateway, repository } = service(provider);
  await assert.rejects(
    gateway.execute(principal, command, 'm2-ambiguous'),
    (error: unknown) =>
      error instanceof Error && error.message.includes('not confirmed'),
  );
  assert.deepEqual(repository.failed, [{ ambiguous: true, cancelled: false }]);
});

test('caller cancellation produces one terminal transition owner', async () => {
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const provider: ProviderAdapter = {
    id: 'openrouter',
    async *stream(_request, signal) {
      yield { type: 'started', requestId: 'req-cancel' };
      started();
      await new Promise<never>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), {
          once: true,
        });
      });
    },
  };
  const repository = new FakeRepository();
  const control = new FakeControl();
  const { gateway } = service(provider, repository, control);
  const running = gateway.execute(principal, command, 'm2-cancel');

  await ready;
  await gateway.cancel(principal, executionId, 'user requested stop');
  await assert.rejects(running);

  assert.equal(control.cancelCalls, 1);
  assert.deepEqual(repository.failed, [{ ambiguous: true, cancelled: true }]);
});

function providerRequest(credentialRef: string): ProviderRequest {
  return {
    capability: 'chat',
    model: 'test-model',
    credentialRef,
    messages: [{ role: 'user', text: 'hello' }],
    maxOutputTokens: 32,
    timeoutMs: 1000,
  };
}
function sseResponse(frames: string[]) {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const frame of frames) {
          controller.enqueue(encoder.encode(frame));
        }
        controller.close();
      },
    }),
    { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
  );
}

test('OpenRouter adapter maps deltas and provider-reported usage', async () => {
  const adapter = new OpenRouterAdapter('test-key', async () =>
    sseResponse([
      'data: {"id":"or-1","choices":[{"delta":{"content":"hi"}}]}\n\n',
      'data: {"id":"or-1","choices":[],"usage":{"prompt_tokens":4,"completion_tokens":2}}\n\n',
      'data: [DONE]\n\n',
    ]),
  );
  const events = [];
  for await (const event of adapter.stream(
    providerRequest('env:M2_OPENROUTER_API_KEY'),
    new AbortController().signal,
  )) {
    events.push(event);
  }
  assert.equal(events.find((event) => event.type === 'delta')?.type, 'delta');
  assert.deepEqual(
    events.find((event) => event.type === 'usage'),
    { type: 'usage', inputTokens: 4, outputTokens: 2 },
  );
});

test('Anthropic adapter maps cumulative message usage without summing stream deltas', async () => {
  const adapter = new AnthropicAdapter('test-key', async () =>
    sseResponse([
      'event: message_start\ndata: {"type":"message_start","message":{"id":"an-1","usage":{"input_tokens":5}}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"ok"}}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":3}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ]),
  );
  const events = [];
  for await (const event of adapter.stream(
    providerRequest('env:M2_ANTHROPIC_API_KEY'),
    new AbortController().signal,
  )) {
    events.push(event);
  }
  assert.deepEqual(
    events.find((event) => event.type === 'usage'),
    { type: 'usage', inputTokens: 5, outputTokens: 3 },
  );
});

test('provider credential refs fail closed before network dispatch', async () => {
  let calls = 0;
  const adapter = new OpenRouterAdapter('test-key', async () => {
    calls++;
    return sseResponse([]);
  });
  await assert.rejects(async () => {
    for await (const _event of adapter.stream(
      providerRequest('vault:some-other-secret'),
      new AbortController().signal,
    )) {
      /* consume */
    }
  }, /PROVIDER_CREDENTIAL_REF_UNSUPPORTED/);
  assert.equal(calls, 0);
});
function streamEvent(
  sequence: number,
  type: GatewayStreamEvent['type'] = 'model.delta',
): GatewayStreamEvent {
  return {
    schema_version: '1',
    id: executionId + ':' + sequence,
    execution_id: executionId,
    sequence,
    type,
    occurred_at: new Date().toISOString(),
    payload: type === 'model.delta' ? { text: String(sequence) } : {},
  };
}

test('replay watch resumes after a cursor and tails live events through terminal', async () => {
  const replay = new InMemoryReplayStore();
  const started = streamEvent(0, 'execution.started');
  replay.append(started);

  const watch = replay.watch(executionId, started.id, true);
  assert.equal(watch.page.expired, false);
  assert.deepEqual(watch.page.events, []);

  const deltaPending = watch.next();
  const delta = streamEvent(1);
  replay.append(delta);
  assert.equal((await deltaPending)?.id, delta.id);
  const terminalPending = watch.next();
  const completed = streamEvent(2, 'execution.completed');
  replay.append(completed);
  assert.equal((await terminalPending)?.type, 'execution.completed');
  assert.equal(await watch.next(), null);
});

test('slow replay subscriber receives bounded reset instead of an unbounded queue', async () => {
  const replay = new InMemoryReplayStore();
  const watch = replay.watch(executionId, undefined, true);

  for (let sequence = 0; sequence <= 64; sequence++) {
    replay.append(streamEvent(sequence));
  }

  const reset = await watch.next();
  assert.equal(reset?.type, 'stream.reset_required');
  assert.equal(reset?.payload.reason, 'slow_consumer');
  assert.equal(await watch.next(), null);
});

test('unknown replay cursor is explicitly expired and cannot silently attach', async () => {
  const replay = new InMemoryReplayStore();
  replay.append(streamEvent(0, 'execution.started'));

  const watch = replay.watch(executionId, 'unknown-cursor', true);
  assert.equal(watch.page.expired, true);
  assert.deepEqual(watch.page.events, []);
  assert.equal(await watch.next(), null);
});
test('provider transport failure is classified as ambiguous after dispatch', async () => {
  const adapter = new OpenRouterAdapter('test-key', async () => {
    throw new TypeError('socket reset');
  });
  await assert.rejects(
    async () => {
      for await (const _event of adapter.stream(
        providerRequest('env:M2_OPENROUTER_API_KEY'),
        new AbortController().signal,
      )) {
        /* consume */
      }
    },
    (error: unknown) =>
      error instanceof ProviderError &&
      error.outcome === 'unknown' &&
      error.code === 'OPENROUTER_TRANSPORT_ERROR',
  );
});

test('invalid provider UTF-8 is an ambiguous stream failure', async () => {
  const adapter = new OpenRouterAdapter(
    'test-key',
    async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(Uint8Array.from([0xff, 0xfe]));
            controller.close();
          },
        }),
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      ),
  );
  await assert.rejects(
    async () => {
      for await (const _event of adapter.stream(
        providerRequest('env:M2_OPENROUTER_API_KEY'),
        new AbortController().signal,
      )) {
        /* consume */
      }
    },
    (error: unknown) =>
      error instanceof ProviderError &&
      error.outcome === 'unknown' &&
      error.code === 'PROVIDER_STREAM_READ_FAILED',
  );
});
