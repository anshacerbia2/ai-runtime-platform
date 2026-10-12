import { performance } from 'node:perf_hooks';
import {
  apiContract,
  RunnerLeaseAck,
  RunnerLeaseCommand,
} from '@ai-runtime/contracts/http';
import type { LeaseRenewalPort, MonotonicClock } from './runner-lease-gate.js';

const MAX_RESPONSE_BYTES = 65_536;

export interface RunnerLeaseHttpOptions {
  origin: string;
  bearerToken: () => Promise<string>;
  timeoutMs: number;
  /** Test fixture only; production must use HTTPS and network policy. */
  allowHttpLoopbackForTests?: boolean;
  fetchImpl?: typeof fetch;
}

function trustedOrigin(options: RunnerLeaseHttpOptions): URL {
  const origin = new URL(options.origin);
  if (
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash ||
    origin.pathname !== '/' ||
    !Number.isSafeInteger(options.timeoutMs) ||
    options.timeoutMs < 100 ||
    options.timeoutMs > 3_000 ||
    (origin.protocol !== 'https:' &&
      !(
        options.allowHttpLoopbackForTests &&
        origin.protocol === 'http:' &&
        ['127.0.0.1', '[::1]'].includes(origin.hostname)
      ))
  ) {
    throw new Error('Invalid trusted runner API origin or timeout.');
  }
  return origin;
}

async function boundedJson(response: Response): Promise<unknown> {
  const length = response.headers.get('content-length');
  if (
    response.status !== 200 ||
    response.redirected ||
    !/^application\/json(?:\s*;|\s*$)/i.test(
      response.headers.get('content-type') ?? '',
    ) ||
    (length !== null &&
      (!/^\d+$/.test(length) || Number(length) > MAX_RESPONSE_BYTES)) ||
    !response.body
  ) {
    throw new Error('Invalid runner lease response.');
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
        throw new Error('Runner lease response exceeded its byte limit.');
      }
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
}

/** One exact lease command; no redirect or automatic retry on ambiguous outcome. */
export class RunnerLeaseHttpClient implements LeaseRenewalPort {
  private readonly origin: URL;
  private readonly command: RunnerLeaseCommand;
  private readonly fetchImpl: typeof fetch;
  private readonly bearerToken: () => Promise<string>;
  private readonly timeoutMs: number;

  constructor(
    command: RunnerLeaseCommand,
    options: RunnerLeaseHttpOptions,
    private readonly clock: MonotonicClock = { nowMs: () => performance.now() },
  ) {
    this.command = RunnerLeaseCommand.parse(command);
    this.origin = trustedOrigin(options);
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.bearerToken = options.bearerToken;
    this.timeoutMs = options.timeoutMs;
  }

  /** Pass startedAtMs and the same clock to RunnerLeaseGate after this succeeds. */
  async activate(): Promise<{ startedAtMs: number; ack: RunnerLeaseAck }> {
    const startedAtMs = this.clock.nowMs();
    if (!Number.isFinite(startedAtMs) || startedAtMs < 0) {
      throw new Error('Runner lease clock is invalid.');
    }
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error('Runner lease activation timed out.'));
      }, this.timeoutMs);
    });
    try {
      const ack = await Promise.race([
        this.request(controller.signal),
        deadline,
      ]);
      return { startedAtMs, ack };
    } catch {
      throw new Error('Runner lease activation failed.');
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  async renew(): Promise<void> {
    await this.activate();
  }

  private async request(signal: AbortSignal): Promise<RunnerLeaseAck> {
    const token = await this.bearerToken();
    if (signal.aborted || !token || !/^[\x21-\x7e]+$/.test(token)) {
      throw new Error('Runner credential unavailable.');
    }
    const response = await this.fetchImpl(
      new URL(apiContract.runner.activateLease.path, this.origin),
      {
        method: apiContract.runner.activateLease.method,
        headers: {
          authorization: `Bearer ${token}`,
          accept: 'application/json',
          'content-type': 'application/json',
          'x-runner-protocol': '1',
        },
        body: JSON.stringify(this.command),
        redirect: 'error',
        cache: 'no-store',
        signal,
      },
    );
    return RunnerLeaseAck.parse(await boundedJson(response));
  }
}
