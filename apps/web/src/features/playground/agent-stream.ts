import {
  AgentRunEvent,
  browserContract,
  type AgentToolName,
} from '@ai-runtime/contracts/http';
import { ApiClientError } from '../../shared/api/http-error';
import type { PlaygroundMessage } from './chat-stream';
import { readEventStream, responseFailure } from './sse';

export interface AgentRunInput {
  profile: string;
  input: string;
  system: string;
  history: readonly PlaygroundMessage[];
  tools: readonly AgentToolName[];
  maxSteps: number;
  maxOutputTokens: number;
  signal: AbortSignal;
}

/** One step of a run as the Playground shows it. */
export interface AgentStep {
  step: number;
  executionId: string | null;
  thought: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  tool: string | null;
  arguments: Record<string, unknown> | null;
  toolStatus: 'SUCCEEDED' | 'FAILED' | null;
  toolOutput: string | null;
}

export function agentRequestBody(input: Omit<AgentRunInput, 'signal'>) {
  return {
    profile: input.profile,
    input: input.input,
    ...(input.system.trim() ? { system: input.system.trim() } : {}),
    history: input.history
      .filter((message) => message.text.trim())
      .slice(-40)
      .map((message) => ({ role: message.role, text: message.text })),
    tools: [...input.tools],
    max_steps: input.maxSteps,
    max_output_tokens: input.maxOutputTokens,
  };
}

/** Runs one agent task through the BFF; closing the stream cancels the run. */
export async function streamAgentRun(
  input: AgentRunInput,
  onEvent: (event: AgentRunEvent) => void,
  transport: typeof fetch = fetch,
): Promise<void> {
  const response = await transport(browserContract.agent.run.path, {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    signal: input.signal,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify(agentRequestBody(input)),
  });
  if (!response.ok) {
    throw await responseFailure(response, 'The agent run was rejected.');
  }
  const type = response.headers.get('content-type')?.toLowerCase() ?? '';
  if (!type.startsWith('text/event-stream')) {
    throw new ApiClientError({
      kind: 'invalid-response',
      status: response.status,
      code: 'INVALID_STREAM',
      message: 'The agent run did not return an event stream.',
    });
  }
  await readEventStream(response, (data) => {
    const parsed = AgentRunEvent.safeParse(data);
    if (parsed.success) {
      onEvent(parsed.data);
    }
  });
}

/** Folds one event into the step list; returns a new array. */
export function applyAgentEvent(
  steps: readonly AgentStep[],
  event: AgentRunEvent,
): AgentStep[] {
  if (!('step' in event.payload)) {
    return [...steps];
  }
  const number = event.payload.step;
  const current: AgentStep = steps.find((item) => item.step === number) ?? {
    step: number,
    executionId: null,
    thought: null,
    inputTokens: null,
    outputTokens: null,
    tool: null,
    arguments: null,
    toolStatus: null,
    toolOutput: null,
  };
  let next: AgentStep = current;
  switch (event.type) {
    case 'model.dispatched':
      next = { ...current, executionId: event.payload.execution_id };
      break;
    case 'model.completed':
      next = {
        ...current,
        executionId: event.payload.execution_id ?? current.executionId,
        thought: event.payload.thought,
        inputTokens: event.payload.input_tokens,
        outputTokens: event.payload.output_tokens,
      };
      break;
    case 'tool.called':
      next = {
        ...current,
        tool: event.payload.tool,
        arguments: event.payload.arguments,
      };
      break;
    case 'tool.completed':
      next = {
        ...current,
        toolStatus: event.payload.status,
        toolOutput: event.payload.output,
      };
      break;
  }
  const rest = steps.filter((item) => item.step !== number);
  return [...rest, next].sort((a, b) => a.step - b.step);
}
