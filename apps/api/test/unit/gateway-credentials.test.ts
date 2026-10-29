import assert from 'node:assert/strict';
import test from 'node:test';
import type { ProviderCredentialBinding } from '../../src/modules/gateway/application/provider-credential.port.js';
import {
  ConfiguredProviderCredentialSource,
  RegistryProviderCredentialResolver,
} from '../../src/modules/gateway/infrastructure/provider-credential-resolver.js';
import { OpenRouterAdapter } from '../../src/modules/gateway/infrastructure/openrouter.adapter.js';
import { AnthropicAdapter } from '../../src/modules/gateway/infrastructure/anthropic.adapter.js';
import {
  ProviderError,
  type ProviderRequest,
} from '../../src/modules/gateway/application/provider-adapter.port.js';

const binding: ProviderCredentialBinding = {
  applicationId: 'app-a',
  executionId: 'execution-a',
  attemptId: 'attempt-a',
  invocationId: 'invocation-a',
  ownerInstanceId: 'owner-a',
  connectionId: 'account-a',
  credentialId: 'credential-a',
  credentialRevision: 1,
  provider: 'openrouter',
  credentialRef: 'secret:account-a/v1',
};
const entries = () => [
  {
    connectionId: 'account-a',
    provider: 'openrouter' as const,
    credentialRef: 'secret:account-a/v1',
    apiKey: 'key-account-a',
  },
  {
    connectionId: 'account-b',
    provider: 'openrouter' as const,
    credentialRef: 'secret:account-b/v1',
    apiKey: 'key-account-b',
  },
  {
    connectionId: 'account-c',
    provider: 'direct-anthropic' as const,
    credentialRef: 'secret:account-c/v1',
    apiKey: 'key-account-c',
  },
];
const signal = () => new AbortController().signal;
const request = (value: ProviderCredentialBinding): ProviderRequest => ({
  capability: 'chat',
  model: 'fixture-model',
  credentialRef: value.credentialRef,
  credentialBinding: value,
  messages: [{ role: 'user', text: 'inert input' }],
  maxOutputTokens: 10,
  timeoutMs: 1000,
});
const unavailable = (error: unknown) =>
  error instanceof ProviderError &&
  error.outcome === 'not-sent' &&
  error.code === 'PROVIDER_CREDENTIAL_UNAVAILABLE' &&
  !JSON.stringify(error).includes('sensitive-store-error');

test('two connections on the same provider resolve different keys, with no cross-connection or provider fallback', async () => {
  const configured = entries();
  const source = new ConfiguredProviderCredentialSource(configured);
  assert.equal(JSON.stringify(source).includes('key-account-a'), false);
  configured[0]!.apiKey = 'mutated';
  assert.equal(await source.resolve(binding, signal()), 'key-account-a');
  const second = {
    ...binding,
    connectionId: 'account-b',
    credentialRef: 'secret:account-b/v1',
  };
  assert.equal(await source.resolve(second, signal()), 'key-account-b');
  for (const invalid of [
    { ...second, credentialRef: binding.credentialRef },
    { ...binding, provider: 'direct-anthropic' as const },
    { ...binding, credentialRef: 'env:ARBITRARY_ENV_SECRET' },
  ]) {
    await assert.rejects(source.resolve(invalid, signal()), unavailable);
  }
});

test('registry authority is checked before secret access and again after lookup; disabled/rotated bindings never dispatch', async () => {
  let checks = 0;
  let reads = 0;
  const resolver = new RegistryProviderCredentialResolver(
    {
      async authorizeCredential() {
        return ++checks === 1;
      },
    },
    {
      async resolve() {
        reads++;
        return 'key-account-a';
      },
    },
  );
  await assert.rejects(resolver.resolve(binding, signal()), unavailable);
  assert.equal(checks, 2);
  assert.equal(reads, 1);
  const denied = new RegistryProviderCredentialResolver(
    {
      async authorizeCredential() {
        return false;
      },
    },
    {
      async resolve() {
        throw new Error('must not read');
      },
    },
  );
  await assert.rejects(denied.resolve(binding, signal()), unavailable);
});

test('both actual provider adapters send only the key for the authorized connection', async () => {
  const seen: Array<{ provider: string; key: string | null }> = [];
  const resolver = new RegistryProviderCredentialResolver(
    {
      async authorizeCredential(value) {
        return value.applicationId === 'app-a';
      },
    },
    new ConfiguredProviderCredentialSource(entries()),
  );
  const openrouter = new OpenRouterAdapter(resolver, async (_url, init) => {
    assert.equal(init?.redirect, 'error');
    seen.push({
      provider: 'openrouter',
      key: new Headers(init?.headers).get('authorization'),
    });
    return new Response(
      'data: {"id":"fixture","choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n',
      { headers: { 'content-type': 'text/event-stream' } },
    );
  });
  for (const value of [
    binding,
    {
      ...binding,
      connectionId: 'account-b',
      credentialRef: 'secret:account-b/v1',
    },
  ]) {
    for await (const event of openrouter.stream(request(value), signal())) {
      assert.ok(event.type);
    }
  }
  const anthropic = new AnthropicAdapter(resolver, async (_url, init) => {
    assert.equal(init?.redirect, 'error');
    seen.push({
      provider: 'direct-anthropic',
      key: new Headers(init?.headers).get('x-api-key'),
    });
    return new Response(
      'data: {"type":"message_start","message":{"id":"fixture"}}\n\ndata: {"type":"message_stop"}\n\n',
      { headers: { 'content-type': 'text/event-stream' } },
    );
  });
  const third = {
    ...binding,
    provider: 'direct-anthropic' as const,
    connectionId: 'account-c',
    credentialRef: 'secret:account-c/v1',
  };
  for await (const event of anthropic.stream(request(third), signal())) {
    assert.ok(event.type);
  }
  assert.deepEqual(seen, [
    { provider: 'openrouter', key: 'Bearer key-account-a' },
    { provider: 'openrouter', key: 'Bearer key-account-b' },
    { provider: 'direct-anthropic', key: 'key-account-c' },
  ]);
});

test('foreign application, wrong route and source failure expose no secret and make zero HTTP calls', async () => {
  let calls = 0;
  const resolver = new RegistryProviderCredentialResolver(
    {
      async authorizeCredential(value) {
        return value.applicationId === 'app-a';
      },
    },
    {
      async resolve() {
        throw new Error('sensitive-store-error');
      },
    },
  );
  const adapter = new OpenRouterAdapter(resolver, async () => {
    calls++;
    throw new Error('must not dispatch');
  });
  for (const value of [
    binding,
    { ...binding, applicationId: 'foreign-app' },
    { ...binding, provider: 'direct-anthropic' as const },
  ]) {
    await assert.rejects(async () => {
      for await (const event of adapter.stream(request(value), signal())) {
        assert.fail(event.type);
      }
    }, unavailable);
  }
  assert.equal(calls, 0);
});

test('cancel during an uncooperative credential lookup returns promptly and never sends after late resolution', async () => {
  let release!: (key: string) => void;
  const pending = new Promise<string>((resolve) => {
    release = resolve;
  });
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let calls = 0;
  const controller = new AbortController();
  const adapter = new OpenRouterAdapter(
    {
      resolve: () => {
        entered();
        return pending;
      },
    },
    async () => {
      calls++;
      throw new Error('must not dispatch');
    },
  );
  const result = (async () => {
    for await (const event of adapter.stream(
      request(binding),
      controller.signal,
    )) {
      assert.fail(event.type);
    }
  })();
  await started;
  controller.abort();
  await assert.rejects(result, { name: 'AbortError' });
  release('late-secret');
  await Promise.resolve();
  assert.equal(calls, 0);
});

test('mapped adapters reject missing/mismatched internal binding and invalid secret material before HTTP', async () => {
  let calls = 0;
  for (const key of ['', 'inert-key\r\nx-header:bad']) {
    const adapter = new OpenRouterAdapter(
      {
        async resolve() {
          return key;
        },
      },
      async () => {
        calls++;
        throw new Error('must not dispatch');
      },
    );
    for (const value of [
      request(binding),
      { ...request(binding), credentialBinding: undefined },
      { ...request(binding), credentialRef: 'secret:other' },
    ]) {
      await assert.rejects(async () => {
        for await (const event of adapter.stream(value, signal())) {
          assert.fail(event.type);
        }
      }, unavailable);
    }
  }
  assert.equal(calls, 0);
});

test('credential binding is captured before asynchronous authority calls', async () => {
  const mutable = { ...binding };
  const observed: string[] = [];
  const resolver = new RegistryProviderCredentialResolver(
    {
      async authorizeCredential(value) {
        observed.push(value.connectionId);
        mutable.connectionId = 'account-b';
        return true;
      },
    },
    new ConfiguredProviderCredentialSource(entries()),
  );
  assert.equal(await resolver.resolve(mutable, signal()), 'key-account-a');
  assert.deepEqual(observed, ['account-a', 'account-a']);
});
