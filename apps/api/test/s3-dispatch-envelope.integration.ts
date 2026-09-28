import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import {
  CreateBucketCommand,
  DeleteBucketCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { AesGcmDispatchEnvelopeCipher } from '../src/modules/dispatch-envelope/infrastructure/aes-gcm-dispatch-envelope.cipher.js';
import { S3DispatchEnvelopeBlobStore } from '../src/modules/dispatch-envelope/infrastructure/s3-dispatch-envelope-blob.store.js';
import { DispatchEnvelopeError } from '../src/modules/dispatch-envelope/application/dispatch-envelope.service.js';
import { EphemeralDispatchKeyProvider } from './support/ephemeral-dispatch-key-provider.js';
import { loadDispatchObjectStoreTestEnvironment } from '../../../config/environment.mjs';

const testEnvironment = loadDispatchObjectStoreTestEnvironment();

const client = new S3Client({
  endpoint: testEnvironment.endpoint,
  region: 'us-east-1',
  forcePathStyle: true,
  credentials: {
    accessKeyId: testEnvironment.accessKeyId,
    secretAccessKey: testEnvironment.secretAccessKey,
  },
});
const bucket = `dispatch-${randomUUID()}`;
const store = new S3DispatchEnvelopeBlobStore({ bucket, client });

after(async () => {
  await client.send(new DeleteBucketCommand({ Bucket: bucket }));
  client.destroy();
});

test('S3-compatible store keeps only authenticated ciphertext and enforces create-once keys', async () => {
  await client.send(new CreateBucketCommand({ Bucket: bucket }));
  const context = {
    envelopeId: randomUUID(),
    applicationId: `app:${randomUUID()}`,
    executionBindingId: randomUUID(),
    profileRevisionId: randomUUID(),
    inputDigest: randomBytes(32).toString('hex'),
  };
  const secret = Buffer.from(`SYNTHETIC_S3_SECRET_${randomUUID()}`);
  const sealed = await new AesGcmDispatchEnvelopeCipher(
    new EphemeralDispatchKeyProvider(),
  ).seal(context, secret);
  const key = `dispatch-envelopes/v1/${context.envelopeId}`;

  await store.putIfAbsent(key, sealed.ciphertext, sealed.ciphertextSha256);
  const fetched = await store.get(key);
  assert.deepEqual(fetched, sealed.ciphertext);
  assert.equal(Buffer.from(fetched!).includes(secret), false);
  assert.deepEqual(
    (await store.list('dispatch-envelopes/v1/', 10)).map((x) => x.key),
    [key],
  );

  await assert.rejects(
    store.putIfAbsent(key, sealed.ciphertext, sealed.ciphertextSha256),
    (error) =>
      error instanceof DispatchEnvelopeError &&
      error.code === 'ENVELOPE_CONFLICT',
  );
  await store.delete(key);
  assert.equal(await store.get(key), null);
});
