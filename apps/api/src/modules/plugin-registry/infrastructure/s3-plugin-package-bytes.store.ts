import {
  GetObjectCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { addAbortSignal, Readable } from 'node:stream';
import { ApplicationError } from '../../../shared/domain/application-error.js';
import type { PluginPackageBytesStore } from '../application/plugin-registry.port.js';

const OBJECT_KEY =
  /^plugins\/v1\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?:\.signature\.json)?$/i;
const MAX_BYTES = 16 * 1024 * 1024;

export interface S3PluginPackageStoreOptions {
  bucket: string;
  client?: S3Client;
  clientConfig?: S3ClientConfig;
  timeoutMs?: number;
}

/** Fixed-bucket reader with byte bounds enforced while streaming, before buffering. */
export class S3PluginPackageBytesStore implements PluginPackageBytesStore {
  private readonly client: S3Client;
  private readonly ownsClient: boolean;
  private readonly timeoutMs: number;

  constructor(private readonly options: S3PluginPackageStoreOptions) {
    this.timeoutMs = options.timeoutMs ?? 10_000;
    if (
      !options.bucket.trim() ||
      !Number.isSafeInteger(this.timeoutMs) ||
      this.timeoutMs < 1 ||
      this.timeoutMs > 60_000
    ) {
      throw new Error('Invalid plugin object-store configuration.');
    }
    this.client = options.client ?? new S3Client(options.clientConfig ?? {});
    this.ownsClient = !options.client;
  }

  async get(
    key: string,
    maximumBytes: number,
    callerSignal?: AbortSignal,
  ): Promise<Uint8Array | null> {
    if (
      !OBJECT_KEY.test(key) ||
      !Number.isSafeInteger(maximumBytes) ||
      maximumBytes < 1 ||
      maximumBytes > MAX_BYTES
    ) {
      throw new ApplicationError(
        'INVALID_REQUEST',
        'Invalid plugin object request.',
      );
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const signal = callerSignal
      ? AbortSignal.any([callerSignal, controller.signal])
      : controller.signal;
    let body: Readable | undefined;
    let bytes: Buffer | undefined;
    try {
      signal.throwIfAborted();
      const response = await this.client.send(
        new GetObjectCommand({ Bucket: this.options.bucket, Key: key }),
        { abortSignal: signal },
      );
      if (!(response.Body instanceof Readable)) {
        throw new ApplicationError(
          'DEPENDENCY_UNAVAILABLE',
          'Plugin object stream is unavailable.',
        );
      }
      body = response.Body;
      const size = response.ContentLength;
      if (!Number.isSafeInteger(size) || size! < 1 || size! > maximumBytes) {
        throw new ApplicationError(
          'POLICY_DENIED',
          'Plugin object size is invalid.',
        );
      }
      addAbortSignal(signal, body);
      bytes = Buffer.alloc(size!);
      let offset = 0;
      for await (const chunk of body) {
        if (
          !(chunk instanceof Uint8Array) ||
          chunk.byteLength > size! - offset
        ) {
          throw new ApplicationError(
            'POLICY_DENIED',
            'Plugin object exceeds its declared size.',
          );
        }
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      signal.throwIfAborted();
      if (offset !== size) {
        throw new ApplicationError(
          'POLICY_DENIED',
          'Plugin object body has an invalid size.',
        );
      }
      return bytes;
    } catch (error) {
      bytes?.fill(0);
      if (signal.aborted) {
        throw new ApplicationError(
          'DEPENDENCY_UNAVAILABLE',
          'Plugin object read timed out or was aborted.',
        );
      }
      if (error instanceof ApplicationError) {
        throw error;
      }
      if (
        typeof error === 'object' &&
        error !== null &&
        '$metadata' in error &&
        (error as { $metadata?: { httpStatusCode?: number } }).$metadata
          ?.httpStatusCode === 404
      ) {
        return null;
      }
      throw new ApplicationError(
        'DEPENDENCY_UNAVAILABLE',
        'Plugin object read failed.',
      );
    } finally {
      clearTimeout(timer);
      body?.destroy();
    }
  }

  destroy() {
    if (this.ownsClient) {
      this.client.destroy();
    }
  }
}
