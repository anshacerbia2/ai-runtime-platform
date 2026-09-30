import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { HttpToolEffectReceiver } from '../../src/modules/tool-effects/infrastructure/http-tool-effect.receiver.js';

test('HTTP tool receiver sends one scoped operation and reads its bounded status', async () => {
  const key = 'a'.repeat(64);
  const input = Buffer.from('synthetic remote mutation');
  const requestDigest = createHash('sha256').update(input).digest('hex');
  const receipt = {
    state: 'COMMITTED',
    receipt_ref: 'receipt:test',
    receipt_digest: 'b'.repeat(64),
  };
  let invocations = 0;
  const server = createServer(async (request, response) => {
    assert.equal(request.headers.authorization, 'Bearer local-fixture');
    if (request.method === 'POST' && request.url === '/v1/effects') {
      invocations += 1;
      const chunks: Buffer[] = [];
      for await (const chunk of request) {
        chunks.push(Buffer.from(chunk));
      }
      assert.deepEqual(JSON.parse(Buffer.concat(chunks).toString()), {
        idempotency_key: key,
        request_digest: requestDigest,
        input_base64: input.toString('base64'),
      });
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify(receipt));
      return;
    }
    if (request.method === 'GET' && request.url === `/v1/effects/${key}`) {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify(receipt));
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const receiver = new HttpToolEffectReceiver({
      origin: `http://127.0.0.1:${address.port}`,
      bearerToken: async () => 'local-fixture',
      timeoutMs: 2000,
      allowHttpLoopbackForTests: true,
    });
    assert.deepEqual(await receiver.invoke(key, requestDigest, input), {
      state: 'COMMITTED',
      receiptRef: 'receipt:test',
      receiptDigest: 'b'.repeat(64),
    });
    assert.deepEqual(await receiver.checkStatus(key), {
      state: 'COMMITTED',
      receiptRef: 'receipt:test',
      receiptDigest: 'b'.repeat(64),
    });
    assert.equal(invocations, 1);
  } finally {
    server.close();
  }
});

test('HTTP tool receiver rejects nonlocal plaintext origins and redirects', async () => {
  assert.throws(
    () =>
      new HttpToolEffectReceiver({
        origin: 'http://example.com',
        bearerToken: async () => 'fixture',
        timeoutMs: 2000,
      }),
    /Invalid trusted tool receiver origin/,
  );
  const server = createServer((request, response) => {
    if (request.url?.endsWith('a'.repeat(64))) {
      response.writeHead(302, { location: 'http://127.0.0.1:1/' }).end();
    } else if (request.url?.endsWith('b'.repeat(64))) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('x'.repeat(4097));
    } else {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ state: 'COMMITTED' }));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const receiver = new HttpToolEffectReceiver({
      origin: `http://127.0.0.1:${address.port}`,
      bearerToken: async () => 'fixture',
      timeoutMs: 2000,
      allowHttpLoopbackForTests: true,
    });
    await assert.rejects(receiver.checkStatus('a'.repeat(64)));
    await assert.rejects(receiver.checkStatus('b'.repeat(64)), /byte limit/);
    await assert.rejects(
      receiver.checkStatus('c'.repeat(64)),
      /Invalid tool receiver status or receipt/,
    );
  } finally {
    server.close();
  }
});
