import { GatewayStreamEvent } from '@ai-runtime/contracts/http';
import type {
  ReplayPage,
  ReplayStore,
  ReplayWatch,
} from '../application/replay-store.port.js';

interface Bucket {
  events: GatewayStreamEvent[];
  bytes: number;
  expiresAt: number;
}

interface Subscriber {
  queue: GatewayStreamEvent[];
  bytes: number;
  closed: boolean;
  closeAfterDrain: boolean;
  waiter?: {
    resolve(event: GatewayStreamEvent | null): void;
    reject(error: unknown): void;
  };
}

const MAX_EXECUTIONS = 1000;
const MAX_EVENTS = 256;
const MAX_BYTES = 262_144;
const RETENTION_MS = 10 * 60 * 1000;
const MAX_SUBSCRIBER_EVENTS = 64;
const MAX_SUBSCRIBER_BYTES = 65_536;
const terminal = new Set<GatewayStreamEvent['type']>([
  'execution.completed',
  'execution.failed',
  'execution.cancelled',
  'stream.reset_required',
]);

export class InMemoryReplayStore implements ReplayStore {
  private readonly buckets = new Map<string, Bucket>();
  private readonly subscribers = new Map<string, Set<Subscriber>>();

  append(raw: GatewayStreamEvent) {
    const event = GatewayStreamEvent.parse(raw);
    this.sweep();
    let bucket = this.buckets.get(event.execution_id);
    if (!bucket) {
      bucket = {
        events: [],
        bytes: 0,
        expiresAt: Date.now() + RETENTION_MS,
      };
      this.buckets.set(event.execution_id, bucket);
    }
    const bytes = encodedBytes(event);
    if (bytes <= MAX_BYTES) {
      bucket.events.push(event);
      bucket.bytes += bytes;
      bucket.expiresAt = Date.now() + RETENTION_MS;
      while (bucket.events.length > MAX_EVENTS || bucket.bytes > MAX_BYTES) {
        const removed = bucket.events.shift();
        if (!removed) {
          break;
        }
        bucket.bytes -= encodedBytes(removed);
      }
    }
    this.publish(event);
    while (this.buckets.size > MAX_EXECUTIONS) {
      const oldest = this.buckets.keys().next().value as string | undefined;
      if (!oldest) {
        break;
      }
      this.buckets.delete(oldest);
    }
  }

  read(executionId: string, after?: string): ReplayPage {
    this.sweep();
    const bucket = this.buckets.get(executionId);
    if (!bucket) {
      return { expired: Boolean(after), events: [] };
    }
    if (!after) {
      return { expired: false, events: [...bucket.events] };
    }
    const index = bucket.events.findIndex((event) => event.id === after);
    return index < 0
      ? { expired: true, events: [] }
      : { expired: false, events: bucket.events.slice(index + 1) };
  }

  watch(executionId: string, after?: string, live = true): ReplayWatch {
    const page = this.read(executionId, after);
    const last = page.events.at(-1);
    if (page.expired || !live || (last && terminal.has(last.type))) {
      return closedWatch(page);
    }
    const subscriber: Subscriber = {
      queue: [],
      bytes: 0,
      closed: false,
      closeAfterDrain: false,
    };
    let group = this.subscribers.get(executionId);
    if (!group) {
      group = new Set();
      this.subscribers.set(executionId, group);
    }
    group.add(subscriber);

    const close = () => this.removeSubscriber(executionId, subscriber);
    return {
      page,
      next: (signal) => this.next(executionId, subscriber, signal),
      close,
    };
  }

  clear(executionId: string) {
    this.buckets.delete(executionId);
    for (const subscriber of this.subscribers.get(executionId) ?? []) {
      this.removeSubscriber(executionId, subscriber);
    }
  }

  private publish(event: GatewayStreamEvent) {
    const group = this.subscribers.get(event.execution_id);
    if (!group?.size) {
      return;
    }
    for (const subscriber of [...group]) {
      if (subscriber.closed || subscriber.closeAfterDrain) {
        continue;
      }
      if (subscriber.waiter) {
        const waiter = subscriber.waiter;
        subscriber.waiter = undefined;
        subscriber.closeAfterDrain ||= terminal.has(event.type);
        waiter.resolve(event);
        continue;
      }
      const eventBytes = encodedBytes(event);
      if (
        subscriber.queue.length >= MAX_SUBSCRIBER_EVENTS ||
        subscriber.bytes + eventBytes > MAX_SUBSCRIBER_BYTES
      ) {
        const reset = GatewayStreamEvent.parse({
          schema_version: '1',
          id: event.execution_id + ':reset:' + event.sequence,
          execution_id: event.execution_id,
          sequence: event.sequence,
          type: 'stream.reset_required',
          occurred_at: new Date().toISOString(),
          payload: { reason: 'slow_consumer' },
        });
        subscriber.queue = [reset];
        subscriber.bytes = encodedBytes(reset);
        subscriber.closeAfterDrain = true;
        continue;
      }
      subscriber.queue.push(event);
      subscriber.bytes += eventBytes;
      subscriber.closeAfterDrain ||= terminal.has(event.type);
    }
  }

  private next(
    executionId: string,
    subscriber: Subscriber,
    signal?: AbortSignal,
  ): Promise<GatewayStreamEvent | null> {
    if (subscriber.queue.length) {
      const event = subscriber.queue.shift()!;
      subscriber.bytes -= encodedBytes(event);
      if (subscriber.closeAfterDrain && subscriber.queue.length === 0) {
        this.removeSubscriber(executionId, subscriber, false);
      }
      return Promise.resolve(event);
    }
    if (subscriber.closed || subscriber.closeAfterDrain) {
      this.removeSubscriber(executionId, subscriber);
      return Promise.resolve(null);
    }
    return new Promise<GatewayStreamEvent | null>((resolve, reject) => {
      const cleanup = () => signal?.removeEventListener('abort', abort);
      const abort = () => {
        if (subscriber.waiter?.resolve === accept) {
          subscriber.waiter = undefined;
        }
        cleanup();
        reject(
          signal?.reason ??
            new DOMException('Replay watch aborted.', 'AbortError'),
        );
      };
      const accept = (event: GatewayStreamEvent | null) => {
        cleanup();
        resolve(event);
      };
      subscriber.waiter = { resolve: accept, reject };
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) {
        abort();
      }
    });
  }

  private removeSubscriber(
    executionId: string,
    subscriber: Subscriber,
    resolveWaiter = true,
  ) {
    if (subscriber.closed) {
      return;
    }
    subscriber.closed = true;
    const waiter = subscriber.waiter;
    subscriber.waiter = undefined;
    if (resolveWaiter) {
      waiter?.resolve(null);
    }
    const group = this.subscribers.get(executionId);
    group?.delete(subscriber);
    if (!group?.size) {
      this.subscribers.delete(executionId);
    }
  }

  private sweep() {
    const now = Date.now();
    for (const [id, bucket] of this.buckets) {
      if (bucket.expiresAt <= now) {
        this.buckets.delete(id);
      }
    }
  }
}

function encodedBytes(event: GatewayStreamEvent) {
  return Buffer.byteLength(JSON.stringify(event), 'utf8');
}

function closedWatch(page: ReplayPage): ReplayWatch {
  return {
    page,
    next: async () => null,
    close() {
      /* Already closed. */
    },
  };
}
