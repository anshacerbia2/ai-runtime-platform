import {
  browserContract,
  GatewayExecution,
  GatewayStreamEvent,
} from '@ai-runtime/contracts/http';
import { readEventStream, responseFailure } from './sse';

export interface PlaygroundMessage {
  role: 'user' | 'assistant';
  text: string;
}

export interface ChatStreamRequest {
  profile: string;
  system: string;
  messages: readonly PlaygroundMessage[];
  maxOutputTokens: number;
  signal: AbortSignal;
}

export type ChatStreamUpdate =
  | { kind: 'started'; executionId: string; provider: string; model: string }
  | { kind: 'delta'; text: string }
  | { kind: 'usage'; inputTokens: number | null; outputTokens: number | null }
  | { kind: 'completed'; finishReason: string | null }
  | { kind: 'failed'; code: string }
  | { kind: 'cancelled' };

export function chatRequestBody(request: Omit<ChatStreamRequest, 'signal'>) {
  const messages = [
    ...(request.system.trim()
      ? [{ role: 'system' as const, text: request.system.trim() }]
      : []),
    ...request.messages.filter((message) => message.text.trim()),
  ];
  return {
    profile: request.profile,
    stream: true,
    constraints: { max_output_tokens: request.maxOutputTokens },
    input: {
      messages: messages.map((message) => ({
        role: message.role,
        content: [{ type: 'text' as const, text: message.text }],
      })),
    },
  };
}

/** One chat turn through the BFF gateway route. Each turn is a new execution with its own key. */
export async function streamChat(
  request: ChatStreamRequest,
  onUpdate: (update: ChatStreamUpdate) => void,
  transport: typeof fetch = fetch,
): Promise<void> {
  const response = await transport(browserContract.gateway.chat.path, {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    signal: request.signal,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      'Idempotency-Key': 'playground-' + crypto.randomUUID(),
    },
    body: JSON.stringify(chatRequestBody(request)),
  });
  const type = response.headers.get('content-type')?.toLowerCase() ?? '';
  if (!response.ok) {
    throw await responseFailure(response, 'The gateway rejected the request.');
  }
  if (!type.startsWith('text/event-stream')) {
    // A JSON snapshot instead of a stream: report its terminal result.
    const execution = GatewayExecution.parse(await response.json());
    onUpdate({
      kind: 'started',
      executionId: execution.executionId,
      provider: execution.provider,
      model: execution.model,
    });
    if (execution.result?.kind === 'text') {
      onUpdate({ kind: 'delta', text: execution.result.text });
    }
    onUpdate({
      kind: 'usage',
      inputTokens: execution.usage.inputTokens,
      outputTokens: execution.usage.outputTokens,
    });
    onUpdate(
      execution.status === 'COMPLETED'
        ? { kind: 'completed', finishReason: execution.finishReason }
        : execution.status === 'CANCELLED'
          ? { kind: 'cancelled' }
          : { kind: 'failed', code: execution.status },
    );
    return;
  }
  await readEventStream(response, (data) => {
    const parsed = GatewayStreamEvent.safeParse(data);
    const update = parsed.success ? toUpdate(parsed.data) : null;
    if (update) {
      onUpdate(update);
    }
  });
}

function toUpdate(event: GatewayStreamEvent): ChatStreamUpdate | null {
  const payload = event.payload;
  const text = (name: string) =>
    typeof payload[name] === 'string' ? (payload[name] as string) : null;
  const count = (name: string) =>
    typeof payload[name] === 'number' ? (payload[name] as number) : null;
  switch (event.type) {
    case 'execution.started':
      return {
        kind: 'started',
        executionId: event.execution_id,
        provider: text('provider') ?? 'unknown',
        model: text('model') ?? 'unknown',
      };
    case 'model.delta':
      return { kind: 'delta', text: text('text') ?? '' };
    case 'usage.updated':
      return {
        kind: 'usage',
        inputTokens: count('input_tokens'),
        outputTokens: count('output_tokens'),
      };
    case 'execution.completed':
      return { kind: 'completed', finishReason: text('finish_reason') };
    case 'execution.failed':
      return { kind: 'failed', code: text('code') ?? 'FAILED' };
    case 'execution.cancelled':
      return { kind: 'cancelled' };
    default:
      return null;
  }
}

export async function cancelExecution(
  executionId: string,
  transport: typeof fetch = fetch,
): Promise<void> {
  await transport(
    browserContract.gateway.cancel.path.replace(
      ':id',
      encodeURIComponent(executionId),
    ),
    {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Stopped from the Playground.' }),
    },
  );
}
