import {
  ProviderError,
  type ProviderAdapter,
  type ProviderEvent,
  type ProviderRequest,
} from '../application/provider-adapter.port.js';
import { readSse } from './provider-sse.js';

const defaultEndpoint = 'https://api.anthropic.com/v1/messages';

export class AnthropicAdapter implements ProviderAdapter {
  readonly id = 'direct-anthropic' as const;
  constructor(
    private readonly apiKey?: string,
    private readonly transport: typeof fetch = fetch,
    private readonly endpoint = defaultEndpoint,
  ) {}

  async *stream(
    request: ProviderRequest,
    signal: AbortSignal,
  ): AsyncIterable<ProviderEvent> {
    if (request.credentialRef !== 'env:M2_ANTHROPIC_API_KEY') {
      throw new ProviderError(
        this.id,
        'PROVIDER_CREDENTIAL_REF_UNSUPPORTED',
        'not-sent',
      );
    }
    if (!this.apiKey || request.credentialRef !== 'env:M2_ANTHROPIC_API_KEY') {
      throw new ProviderError(
        this.id,
        'PROVIDER_CREDENTIAL_UNAVAILABLE',
        'not-sent',
      );
    }
    const system = request.messages
      .filter((message) => message.role === 'system')
      .map((message) => message.text)
      .join('\n\n');
    const messages = request.messages
      .filter((message) => message.role !== 'system')
      .map((message) => ({
        role: message.role,
        content: message.text,
      }));
    let response: Response;
    try {
      response = await this.transport(this.endpoint, {
        method: 'POST',
        headers: {
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify({
          model: request.model,
          max_tokens: request.maxOutputTokens,
          messages,
          ...(system ? { system } : {}),
          stream: true,
        }),
        signal,
      });
    } catch (error) {
      if (signal.aborted) {
        throw error;
      }
      throw new ProviderError(this.id, 'ANTHROPIC_TRANSPORT_ERROR', 'unknown');
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new ProviderError(
        this.id,
        'ANTHROPIC_HTTP_' + response.status,
        response.status < 500 ? 'rejected' : 'unknown',
        response.status,
      );
    }
    const type = response.headers.get('content-type')?.toLowerCase() ?? '';
    if (!type.startsWith('text/event-stream')) {
      await response.body?.cancel().catch(() => undefined);
      throw new ProviderError(
        this.id,
        'INVALID_PROVIDER_MEDIA_TYPE',
        'unknown',
      );
    }
    let requestId: string | null = null;
    let finishReason: string | null = null;
    let started = false;
    let completed = false;
    let inputTokens: number | null = null;
    for await (const record of readSse(response, this.id)) {
      let value: unknown;
      try {
        value = JSON.parse(record.data);
      } catch {
        throw new ProviderError(this.id, 'INVALID_PROVIDER_JSON', 'unknown');
      }
      if (!value || typeof value !== 'object') {
        continue;
      }
      const row = value as Record<string, unknown>;
      if (record.event === 'error' || row.type === 'error') {
        throw new ProviderError(this.id, 'ANTHROPIC_STREAM_ERROR', 'unknown');
      }
      if (
        row.type === 'message_start' &&
        row.message &&
        typeof row.message === 'object'
      ) {
        const message = row.message as Record<string, unknown>;
        requestId = typeof message.id === 'string' ? message.id : requestId;
        started = true;
        if (message.usage && typeof message.usage === 'object') {
          inputTokens = integer(
            (message.usage as Record<string, unknown>).input_tokens,
          );
        }
        yield { type: 'started', requestId };
      } else if (
        row.type === 'content_block_delta' &&
        row.delta &&
        typeof row.delta === 'object'
      ) {
        const delta = row.delta as Record<string, unknown>;
        if (delta.type === 'text_delta' && typeof delta.text === 'string') {
          yield { type: 'delta', text: delta.text };
        }
      } else if (row.type === 'message_stop') {
        completed = true;
      } else if (row.type === 'message_delta') {
        const delta =
          row.delta && typeof row.delta === 'object'
            ? (row.delta as Record<string, unknown>)
            : undefined;
        if (typeof delta?.stop_reason === 'string') {
          finishReason = delta.stop_reason;
        }
        if (row.usage && typeof row.usage === 'object') {
          const usage = row.usage as Record<string, unknown>;
          yield {
            type: 'usage',
            inputTokens,
            outputTokens: integer(usage.output_tokens),
          };
        }
      }
    }
    if (!started) {
      throw new ProviderError(this.id, 'EMPTY_PROVIDER_STREAM', 'unknown');
    }
    if (!completed) {
      throw new ProviderError(this.id, 'PROVIDER_STREAM_TRUNCATED', 'unknown');
    }
    yield { type: 'done', requestId, finishReason };
  }
}

function integer(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}
