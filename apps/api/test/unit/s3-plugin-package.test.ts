import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import type { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { ApplicationError } from '../../src/shared/domain/application-error.js';
import { S3PluginPackageBytesStore } from '../../src/modules/plugin-registry/infrastructure/s3-plugin-package-bytes.store.js';

const key = `plugins/v1/${randomUUID()}`;
const denied = (error: unknown) =>
  error instanceof ApplicationError && error.code === 'POLICY_DENIED';
const unavailable = (error: unknown) =>
  error instanceof ApplicationError && error.code === 'DEPENDENCY_UNAVAILABLE';

function store(
  response: { Body: Readable; ContentLength?: number },
  timeoutMs = 1000,
) {
  const commands: GetObjectCommand[] = [];
  const client = {
    async send(command: GetObjectCommand) {
      commands.push(command);
      return response;
    },
  } as unknown as S3Client;
  return {
    reader: new S3PluginPackageBytesStore({
      bucket: 'trusted-plugins',
      client,
      timeoutMs,
    }),
    commands,
  };
}

test('S3 plugin reader uses a fixed bucket and reads declared bounded bytes', async () => {
  const f = store({
    Body: Readable.from([Buffer.from('one'), Buffer.from('two')]),
    ContentLength: 6,
  });
  assert.equal(Buffer.from((await f.reader.get(key, 6))!).toString(), 'onetwo');
  assert.deepEqual(f.commands[0]!.input, {
    Bucket: 'trusted-plugins',
    Key: key,
  });
  await assert.rejects(
    f.reader.get('https://untrusted.test/plugin', 6),
    ApplicationError,
  );
  assert.equal(f.commands.length, 1);
});

test('S3 reader rejects missing/oversize headers, truncated bodies and lying ContentLength', async () => {
  for (const response of [
    { Body: Readable.from([Buffer.from('small')]), ContentLength: 99 },
    { Body: Readable.from([Buffer.from('small')]) },
    { Body: Readable.from([Buffer.from('one')]), ContentLength: 6 },
    {
      Body: Readable.from([Buffer.from('one'), Buffer.from('too much')]),
      ContentLength: 6,
    },
    { Body: Readable.from(['text-chunk']), ContentLength: 10 },
  ]) {
    await assert.rejects(store(response).reader.get(key, 10), denied);
    assert.equal(response.Body.destroyed, true);
  }
});

test('S3 read deadline interrupts a stalled response stream', async () => {
  const body = new Readable({ read() {} });
  await assert.rejects(
    store({ Body: body, ContentLength: 10 }, 20).reader.get(key, 10),
    unavailable,
  );
  assert.equal(body.destroyed, true);
});

test('S3 read respects caller abort, missing objects and sanitizes upstream errors', async () => {
  const controller = new AbortController();
  controller.abort();
  const f = store({
    Body: Readable.from([Buffer.from('one')]),
    ContentLength: 3,
  });
  await assert.rejects(f.reader.get(key, 10, controller.signal), unavailable);
  assert.equal(f.commands.length, 0);
  const client = {
    async send() {
      throw { $metadata: { httpStatusCode: 404 } };
    },
  } as unknown as S3Client;
  assert.equal(
    await new S3PluginPackageBytesStore({ bucket: 'trusted', client }).get(
      key,
      10,
    ),
    null,
  );
  const broken = {
    async send() {
      throw new Error('credential-SECRET');
    },
  } as unknown as S3Client;
  await assert.rejects(
    new S3PluginPackageBytesStore({ bucket: 'trusted', client: broken }).get(
      key,
      10,
    ),
    (error: unknown) =>
      unavailable(error) &&
      error instanceof Error &&
      !error.message.includes('SECRET'),
  );
});
