import type {
  ToolEffectReceiver,
  ToolReceiverOutcome,
} from '../application/tool-effect.port.js';

const KEY = /^[a-f0-9]{64}$/;
const RECEIPT_REF = /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,255}$/;
const MAX_RESPONSE_BYTES = 4096;

export interface HttpToolEffectReceiverOptions {
  origin: string;
  bearerToken: () => Promise<string>;
  timeoutMs: number;
  /** Test fixture only; production must use HTTPS and network egress policy. */
  allowHttpLoopbackForTests?: boolean;
}

function boundedOrigin(options: HttpToolEffectReceiverOptions): URL {
  const origin = new URL(options.origin);
  if (
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash ||
    origin.pathname !== '/' ||
    !Number.isSafeInteger(options.timeoutMs) ||
    options.timeoutMs < 100 ||
    options.timeoutMs > 30_000 ||
    (origin.protocol !== 'https:' &&
      !(
        options.allowHttpLoopbackForTests &&
        origin.protocol === 'http:' &&
        ['127.0.0.1', '[::1]'].includes(origin.hostname)
      ))
  ) {
    throw new Error('Invalid trusted tool receiver origin or timeout.');
  }
  return origin;
}

function outcome(value: unknown): ToolReceiverOutcome {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Invalid tool receiver status.');
  }
  const data = value as Record<string, unknown>;
  if (data.state === 'UNKNOWN') {
    if (Object.keys(data).length !== 1) {
      throw new Error('Unknown tool outcome cannot contain a receipt.');
    }
    return { state: 'UNKNOWN' };
  }
  if (
    (data.state === 'COMMITTED' || data.state === 'NO_EFFECT') &&
    typeof data.receipt_ref === 'string' &&
    RECEIPT_REF.test(data.receipt_ref) &&
    typeof data.receipt_digest === 'string' &&
    KEY.test(data.receipt_digest) &&
    Object.keys(data).length === 3
  ) {
    return {
      state: data.state,
      receiptRef: data.receipt_ref,
      receiptDigest: data.receipt_digest,
    };
  }
  throw new Error('Invalid tool receiver status or receipt.');
}

/** A configured receiver, never a URL or tool chosen from model output. */
export class HttpToolEffectReceiver implements ToolEffectReceiver {
  private readonly origin: URL;

  constructor(private readonly options: HttpToolEffectReceiverOptions) {
    this.origin = boundedOrigin(options);
  }

  private async request(
    path: string,
    method: 'GET' | 'POST',
    body?: string,
  ): Promise<ToolReceiverOutcome> {
    const token = await this.options.bearerToken();
    if (!token || /[\r\n]/.test(token)) {
      throw new Error('Tool receiver credential is unavailable.');
    }
    const response = await fetch(new URL(path, this.origin), {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/json',
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body,
      redirect: 'error',
      signal: AbortSignal.timeout(this.options.timeoutMs),
      cache: 'no-store',
    });
    if (!response.ok || !response.body) {
      throw new Error('Tool receiver request failed.');
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        bytes += value.byteLength;
        if (bytes > MAX_RESPONSE_BYTES) {
          throw new Error('Tool receiver response exceeded its byte limit.');
        }
        chunks.push(value);
      }
    } catch (error) {
      await reader.cancel().catch(() => undefined);
      throw error;
    } finally {
      reader.releaseLock();
    }
    const buffer = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
      buffer.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return outcome(
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer)),
    );
  }

  invoke(
    idempotencyKey: string,
    requestDigest: string,
    input: Uint8Array,
  ): Promise<ToolReceiverOutcome> {
    if (!KEY.test(idempotencyKey) || !KEY.test(requestDigest)) {
      throw new Error('Invalid tool receiver operation identity.');
    }
    return this.request(
      '/v1/effects',
      'POST',
      JSON.stringify({
        idempotency_key: idempotencyKey,
        request_digest: requestDigest,
        input_base64: Buffer.from(input).toString('base64'),
      }),
    );
  }

  checkStatus(idempotencyKey: string): Promise<ToolReceiverOutcome> {
    if (!KEY.test(idempotencyKey)) {
      throw new Error('Invalid tool receiver operation identity.');
    }
    return this.request(`/v1/effects/${idempotencyKey}`, 'GET');
  }
}
