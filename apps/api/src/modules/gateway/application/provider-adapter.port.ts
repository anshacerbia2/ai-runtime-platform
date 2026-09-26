export type ProviderId = 'openrouter' | 'direct-anthropic';

export interface ProviderMessage {
  role: 'system' | 'user' | 'assistant';
  text: string;
}

export interface ProviderRequest {
  capability: 'chat' | 'generate' | 'structured_generate';
  model: string;
  credentialRef: string;
  messages: ProviderMessage[];
  responseSchema?: Record<string, unknown>;
  maxOutputTokens: number;
  timeoutMs: number;
}

export type ProviderEvent =
  | { type: 'started'; requestId: string | null }
  | { type: 'delta'; text: string }
  | {
      type: 'usage';
      inputTokens: number | null;
      outputTokens: number | null;
    }
  | {
      type: 'done';
      requestId: string | null;
      finishReason: string | null;
    };

export interface ProviderAdapter {
  readonly id: ProviderId;
  stream(
    request: ProviderRequest,
    signal: AbortSignal,
  ): AsyncIterable<ProviderEvent>;
}

export class ProviderError extends Error {
  constructor(
    readonly provider: ProviderId,
    readonly code: string,
    readonly outcome: 'rejected' | 'unknown' | 'not-sent',
    readonly status?: number,
  ) {
    super(code);
    this.name = 'ProviderError';
  }
}
