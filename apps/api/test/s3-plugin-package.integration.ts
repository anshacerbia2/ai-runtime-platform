import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { loadDispatchObjectStoreTestEnvironment } from '../../../config/environment.mjs';
import { SignedPluginPackageReader } from '../src/modules/plugin-registry/infrastructure/signed-plugin-package.reader.js';
import { S3PluginPackageBytesStore } from '../src/modules/plugin-registry/infrastructure/s3-plugin-package-bytes.store.js';
import { ApplicationError } from '../src/shared/domain/application-error.js';
import { signedPluginFixture } from './fixtures/signed-plugin-package.js';

const environment = loadDispatchObjectStoreTestEnvironment();
const client = new S3Client({
  endpoint: environment.endpoint,
  region: 'us-east-1',
  forcePathStyle: true,
  credentials: {
    accessKeyId: environment.accessKeyId,
    secretAccessKey: environment.secretAccessKey,
  },
});
const bucket = `plugin-${randomUUID()}`;
const fixture = signedPluginFixture();
const keys = [
  fixture.record.objectKey,
  `${fixture.record.objectKey}.signature.json`,
];
const store = new S3PluginPackageBytesStore({ bucket, client });
let created = false;

before(async () => {
  await client.send(new CreateBucketCommand({ Bucket: bucket }));
  created = true;
});
after(async () => {
  try {
    if (created) {
      for (const key of keys) {
        await client.send(
          new DeleteObjectCommand({ Bucket: bucket, Key: key }),
        );
      }
      await client.send(new DeleteBucketCommand({ Bucket: bucket }));
    }
  } finally {
    client.destroy();
  }
});

test('S3-compatible plugin reader verifies a stored signed package and rejects tampering', async () => {
  const reader = new SignedPluginPackageReader(store, fixture.keys);
  await assert.rejects(
    reader.verify(fixture.record),
    (error) =>
      error instanceof ApplicationError && error.code === 'POLICY_DENIED',
  );
  for (const key of keys) {
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: fixture.objects.get(key)!,
        IfNoneMatch: '*',
      }),
    );
  }
  const attestation = await reader.verify(fixture.record);
  const verified = await reader.readVerified({
    ...fixture.record,
    state: 'ACTIVE',
    attestationRef: attestation.attestationRef,
  });
  assert.deepEqual(Buffer.from(verified.bytes), fixture.bytes);
  assert.deepEqual(verified.attestation, attestation);
  await assert.rejects(
    store.get(fixture.record.objectKey, 2),
    (error) =>
      error instanceof ApplicationError && error.code === 'POLICY_DENIED',
  );
  // A compromised object store cannot replace signed bytes with equally sized data.
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: fixture.record.objectKey,
      Body: Buffer.alloc(fixture.bytes.byteLength, 65),
    }),
  );
  await assert.rejects(
    reader.readVerified(fixture.record),
    (error) =>
      error instanceof ApplicationError && error.code === 'POLICY_DENIED',
  );
});
