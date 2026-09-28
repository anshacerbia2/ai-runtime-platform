import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import type {
  DispatchEnvelopeBlobStore,
  DispatchObject,
} from '../application/dispatch-envelope.ports.js';
import { DISPATCH_ENVELOPE_MAX_PLAINTEXT_BYTES } from '../application/dispatch-envelope.ports.js';
import { DispatchEnvelopeError } from '../application/dispatch-envelope.service.js';

function statusCode(error: unknown) {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }
  const metadata = (error as { $metadata?: { httpStatusCode?: number } })
    .$metadata;
  return metadata?.httpStatusCode;
}

export interface S3DispatchEnvelopeStoreOptions {
  bucket: string;
  client?: S3Client;
  clientConfig?: S3ClientConfig;
}

/** S3-compatible ciphertext store. It never receives plaintext or data keys. */
export class S3DispatchEnvelopeBlobStore implements DispatchEnvelopeBlobStore {
  private readonly client: S3Client;
  private readonly ownsClient: boolean;

  constructor(private readonly options: S3DispatchEnvelopeStoreOptions) {
    if (!options.bucket.trim()) {
      throw new Error('Dispatch object-store bucket is required.');
    }
    this.client = options.client ?? new S3Client(options.clientConfig ?? {});
    this.ownsClient = !options.client;
  }

  async putIfAbsent(
    key: string,
    ciphertext: Uint8Array,
    ciphertextSha256: string,
  ): Promise<void> {
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.options.bucket,
          Key: key,
          Body: ciphertext,
          ContentType: 'application/octet-stream',
          IfNoneMatch: '*',
          Metadata: { 'ciphertext-sha256': ciphertextSha256 },
        }),
      );
    } catch (error) {
      if (statusCode(error) === 409 || statusCode(error) === 412) {
        throw new DispatchEnvelopeError(
          'ENVELOPE_CONFLICT',
          'Dispatch object key already exists.',
        );
      }
      throw error;
    }
  }

  async get(key: string): Promise<Uint8Array | null> {
    try {
      const response = await this.client.send(
        new GetObjectCommand({ Bucket: this.options.bucket, Key: key }),
      );
      if (!response.Body) {
        return null;
      }
      if (
        response.ContentLength === undefined ||
        response.ContentLength < 1 ||
        response.ContentLength > DISPATCH_ENVELOPE_MAX_PLAINTEXT_BYTES
      ) {
        throw new DispatchEnvelopeError(
          'ENVELOPE_CORRUPT',
          'Dispatch ciphertext has an invalid stored size.',
        );
      }
      const ciphertext = await response.Body.transformToByteArray();
      if (
        ciphertext.byteLength !== response.ContentLength ||
        ciphertext.byteLength > DISPATCH_ENVELOPE_MAX_PLAINTEXT_BYTES
      ) {
        throw new DispatchEnvelopeError(
          'ENVELOPE_CORRUPT',
          'Dispatch ciphertext body does not match its stored size.',
        );
      }
      return ciphertext;
    } catch (error) {
      if (statusCode(error) === 404) {
        return null;
      }
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.options.bucket, Key: key }),
    );
  }

  async list(prefix: string, limit: number): Promise<DispatchObject[]> {
    const response = await this.client.send(
      new ListObjectsV2Command({
        Bucket: this.options.bucket,
        Prefix: prefix,
        MaxKeys: limit,
      }),
    );
    return (response.Contents ?? []).flatMap((item) =>
      item.Key && item.LastModified
        ? [{ key: item.Key, lastModified: item.LastModified }]
        : [],
    );
  }

  destroy() {
    if (this.ownsClient) {
      this.client.destroy();
    }
  }
}
