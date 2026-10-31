// Provider-neutral tool protocol for the agent preview. The model answers with
// one JSON object per turn, so tool use works over the plain chat capability
// of every gateway provider without provider-specific tool APIs.

export interface AgentToolDescriptor {
  name: string;
  description: string;
  // Human-readable argument shape shown to the model, e.g. '{"expression": string}'.
  arguments: string;
}

export type AgentAction =
  | {
      kind: 'tool';
      tool: string;
      arguments: Record<string, unknown>;
      thought: string | null;
    }
  | { kind: 'final'; answer: string; thought: string | null };

export function agentSystemPrompt(
  tools: readonly AgentToolDescriptor[],
  instructions: string | null,
): string {
  const catalogue = tools.length
    ? tools
        .map((tool) => `- ${tool.name} ${tool.arguments}: ${tool.description}`)
        .join('\n')
    : '- (no tools are available for this run)';
  return [
    'You are an agent that can call tools to answer the user.',
    'Reply with exactly one JSON object and nothing else.',
    'To call a tool: {"thought": "<why>", "tool": "<name>", "arguments": {...}}',
    'To answer: {"thought": "<why>", "final": "<answer for the user>"}',
    'Call one tool at a time and wait for its result. Never invent a tool result.',
    'Use a tool whenever it gives a more reliable answer than guessing.',
    'Available tools:',
    catalogue,
    ...(instructions?.trim()
      ? ['Additional instructions from the user:', instructions.trim()]
      : []),
  ].join('\n');
}

export function stepLimitNotice(): string {
  return 'Step limit reached. Do not call any more tools. Reply now with {"final": "<answer>"} using what you already know.';
}

export function toolResultMessage(
  tool: string,
  status: 'SUCCEEDED' | 'FAILED',
  output: string,
): string {
  return status === 'SUCCEEDED'
    ? `Tool result for ${tool}:\n${output}`
    : `Tool ${tool} failed:\n${output}\nDecide whether to try again differently or answer.`;
}

/** Parses one model reply. Text that is not a protocol object is a final answer. */
export function parseAgentReply(raw: string): AgentAction {
  const text = raw.trim();
  const value = firstJsonObject(text);
  if (!value) {
    return { kind: 'final', answer: text, thought: null };
  }
  const thought =
    typeof value.thought === 'string' && value.thought.trim()
      ? value.thought.trim()
      : null;
  if (typeof value.final === 'string') {
    return { kind: 'final', answer: value.final, thought };
  }
  if (typeof value.tool === 'string' && value.tool.trim()) {
    const args = value.arguments;
    return {
      kind: 'tool',
      tool: value.tool.trim(),
      arguments:
        args && typeof args === 'object' && !Array.isArray(args)
          ? (args as Record<string, unknown>)
          : {},
      thought,
    };
  }
  return { kind: 'final', answer: text, thought };
}

function firstJsonObject(text: string): Record<string, unknown> | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidates = [fenced?.[1], text];
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start === -1 || end <= start) {
      continue;
    }
    try {
      const value: unknown = JSON.parse(candidate.slice(start, end + 1));
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        return value as Record<string, unknown>;
      }
    } catch {
      // Not a protocol object; try the next candidate.
    }
  }
  return null;
}
