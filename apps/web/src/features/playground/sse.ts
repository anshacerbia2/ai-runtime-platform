import { ApiClientError, readApiError } from '../../shared/api/http-error';

const maxStreamBytes = 4 * 1024 * 1024;

export interface SseFrame {
  id: string | null;
  event: string | null;
  data: string;
}

/** Splits complete SSE frames off a text buffer; the incomplete tail is returned as `rest`. */
export function takeSseFrames(buffer: string): {
  frames: SseFrame[];
  rest: string;
} {
  const normalized = buffer.replace(/\r\n?/g, '\n');
  const blocks = normalized.split('\n\n');
  const rest = blocks.pop() ?? '';
  const frames: SseFrame[] = [];
  for (const block of blocks) {
    let id: string | null = null;
    let event: string | null = null;
    const data: string[] = [];
    for (const line of block.split('\n')) {
      if (!line || line.startsWith(':')) {
        continue;
      }
      const colon = line.indexOf(':');
      const field = colon === -1 ? line : line.slice(0, colon);
      const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '');
      if (field === 'id') {
        id = value;
      } else if (field === 'event') {
        event = value;
      } else if (field === 'data') {
        data.push(value);
      }
    }
    if (data.length) {
      frames.push({ id, event, data: data.join('\n') });
    }
  }
  return { frames, rest };
}

/** The typed error for a rejected (non-2xx) BFF response. */
export async function responseFailure(
  response: Response,
  fallback: string,
): Promise<ApiClientError> {
  const payload = readApiError(await response.json().catch(() => null));
  return new ApiClientError({
    kind: 'http',
    status: response.status,
    code: payload.code ?? 'HTTP_' + response.status,
    message: payload.message ?? fallback,
    requestId: response.headers.get('x-request-id') ?? undefined,
  });
}

/** Reads a bounded SSE body, passing each frame's parsed JSON data on. */
export async function readEventStream(
  response: Response,
  onData: (data: unknown) => void,
): Promise<void> {
  if (!response.body) {
    throw new ApiClientError({
      kind: 'invalid-response',
      status: response.status,
      code: 'EMPTY_STREAM',
      message: 'The server returned an empty stream.',
    });
  }
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  let received = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) {
      return;
    }
    received += value.length;
    if (received > maxStreamBytes) {
      await reader.cancel();
      throw new ApiClientError({
        kind: 'invalid-response',
        status: response.status,
        code: 'STREAM_TOO_LARGE',
        message: 'The stream exceeded the Playground limit.',
      });
    }
    const { frames, rest } = takeSseFrames(buffer + value);
    buffer = rest;
    for (const frame of frames) {
      let data: unknown;
      try {
        data = JSON.parse(frame.data);
      } catch {
        continue;
      }
      onData(data);
    }
  }
}
