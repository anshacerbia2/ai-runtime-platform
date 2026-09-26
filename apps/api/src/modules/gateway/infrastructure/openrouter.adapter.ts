import {
  ProviderError,
  type ProviderAdapter,
  type ProviderEvent,
  type ProviderRequest,
} from '../application/provider-adapter.port.js';
import { readSse } from './provider-sse.js';

const defaultEndpoint = 'https://openrouter.ai/api/v1/chat/completions';

export class OpenRouterAdapter implements ProviderAdapter {
  readonly id = 'openrouter' as const;
  constructor(
    private readonly apiKey?: string,
    private readonly transport: typeof fetch = fetch,
    private readonly endpoint = defaultEndpoint,
  ) {}

  async *stream(
    request: ProviderRequest,
    signal: AbortSignal,
  ): AsyncIterable<ProviderEvent> {
    if (request.credentialRef !== 'env:M2_OPENROUTER_API_KEY') {
      throw new ProviderError(
        this.id,
        'PROVIDER_CREDENTIAL_REF_UNSUPPORTED',
        'not-sent',
      );
    }
    if (!this.apiKey || request.credentialRef !== 'env:M2_OPENROUTER_API_KEY') {
      throw new ProviderError(
        this.id,
        'PROVIDER_CREDENTIAL_UNAVAILABLE',
        'not-sent',
      );
    }
    let response: Response;
    try {
      response = await this.transport(this.endpoint, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + this.apiKey,
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify({
          model: request.model,
          messages: request.messages.map((message) => ({
            role: message.role,
            content: message.text,
          })),
          max_tokens: request.maxOutputTokens,
          stream: true,
          stream_options: { include_usage: true },
          ...(request.capability === 'structured_generate' &&
          request.responseSchema
            ? {
                response_format: {
                  type: 'json_schema',
                  json_schema: {
                    name: 'platform_response',
                    strict: true,
                    schema: request.responseSchema,
                  },
                },
              }
            : {}),
        }),
        signal,
      });
    } catch (error) {
      if (signal.aborted) {
        throw error;
      }
      throw new ProviderError(this.id, 'OPENROUTER_TRANSPORT_ERROR', 'unknown');
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new ProviderError(
        this.id,
        'OPENROUTER_HTTP_' + response.status,
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
    for await (const record of readSse(response, this.id)) {
      if (record.data === '[DONE]') {
        completed = true;
        break;
      }
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
      if (row.error && typeof row.error === 'object') {
        throw new ProviderError(this.id, 'OPENROUTER_STREAM_ERROR', 'unknown');
      }
      if (typeof row.id === 'string') {
        requestId = row.id;
      }
      if (!started) {
        started = true;
        yield { type: 'started', requestId };
      }
      const choices = Array.isArray(row.choices) ? row.choices : [];
      const first = choices[0];
      if (first && typeof first === 'object') {
        const choice = first as Record<string, unknown>;
        const delta =
          choice.delta && typeof choice.delta === 'object'
            ? (choice.delta as Record<string, unknown>)
            : undefined;
        if (typeof delta?.content === 'string' && delta.content) {
          yield { type: 'delta', text: delta.content };
        }
        if (typeof choice.finish_reason === 'string') {
          finishReason = choice.finish_reason;
        }
      }
      if (row.usage && typeof row.usage === 'object') {
        const usage = row.usage as Record<string, unknown>;
        yield {
          type: 'usage',
          inputTokens: integer(usage.prompt_tokens),
          outputTokens: integer(usage.completion_tokens),
        };
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
