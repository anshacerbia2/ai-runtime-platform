import {
  ProviderError,
  type ProviderId,
} from '../application/provider-adapter.port.js';

export interface SseRecord {
  event: string | null;
  data: string;
}

const MAX_EVENT_BYTES = 65_536;

export async function* readSse(
  response: Response,
  provider: ProviderId,
): AsyncIterable<SseRecord> {
  if (!response.body) {
    throw new ProviderError(provider, 'EMPTY_PROVIDER_STREAM', 'unknown');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let buffer = '';
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) {
        buffer += decoder.decode();
        break;
      }
      buffer += decoder.decode(next.value, { stream: true });
      if (Buffer.byteLength(buffer, 'utf8') > MAX_EVENT_BYTES * 2) {
        throw new ProviderError(
          provider,
          'PROVIDER_EVENT_TOO_LARGE',
          'unknown',
        );
      }
      for (;;) {
        const match = /\r?\n\r?\n/.exec(buffer);
        if (!match || match.index === undefined) {
          break;
        }
        const raw = buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match[0].length);
        const parsed = parseRecord(raw, provider);
        if (parsed) {
          yield parsed;
        }
      }
    }
    if (buffer.trim()) {
      const parsed = parseRecord(buffer, provider);
      if (parsed) {
        yield parsed;
      }
    }
  } catch (error) {
    if (error instanceof ProviderError) {
      throw error;
    }
    throw new ProviderError(provider, 'PROVIDER_STREAM_READ_FAILED', 'unknown');
  } finally {
    try {
      await reader.cancel();
    } catch {
      // Best-effort provider stream cleanup; caller state remains authoritative.
    }
    reader.releaseLock();
  }
}

function parseRecord(raw: string, provider: ProviderId): SseRecord | null {
  if (Buffer.byteLength(raw, 'utf8') > MAX_EVENT_BYTES) {
    throw new ProviderError(provider, 'PROVIDER_EVENT_TOO_LARGE', 'unknown');
  }
  let event: string | null = null;
  const data: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.startsWith(':')) {
      continue;
    }
    if (line.startsWith('event:')) {
      event = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      data.push(line.slice(5).trimStart());
    }
  }
  if (!data.length) {
    return null;
  }
  return { event, data: data.join('\n') };
}
