import assert from 'node:assert/strict';
import { mkdir, readdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PactV3 } from '@pact-foundation/pact';
import { createApiClient } from '../../apps/web/src/shared/api/api-client';
import { forward } from '../../apps/web/src/server/api-gateway/forward';
import { fixtureConfig } from '../../apps/web/test/fixtures';
import { cases } from './expectations';

export const pactDirectory = resolve('.local/pacts/current');
await mkdir(pactDirectory, { recursive: true });
for (const file of await readdir(pactDirectory)) {
  if (file.endsWith('.json')) {
    await rm(resolve(pactDirectory, file));
  }
}

for (const boundary of [
  { consumer: 'runtime-console', provider: 'runtime-bff', bff: false },
  { consumer: 'runtime-bff', provider: 'runtime-api', bff: true },
]) {
  const pact = new PactV3({
    ...boundary,
    dir: pactDirectory,
    logLevel: 'error',
  });
  for (const entry of cases) {
    pact
      .given('isolated platform fixtures')
      .uponReceiving(entry.name)
      .withRequest({
        method: entry.method,
        path: entry.path,
        headers: {
          Accept: 'application/json',
          ...(entry.key
            ? {
                'Idempotency-Key': entry.key,
                'Content-Type': 'application/json',
              }
            : {}),
        },
        ...(entry.body ? { body: entry.body } : {}),
      })
      .willRespondWith({
        status: entry.status,
        headers: { 'Content-Type': 'application/json' },
        body: entry.expected,
      });
  }
  await pact.executeTest(async (mock) => {
    if (!boundary.bff) {
      const client = createApiClient(async (path, init) => {
        const result = await fetch(new URL(String(path), mock.url), init);
        return result;
      });
      for (const entry of cases) {
        const result = await entry.call(client);
        assert.equal(result.status, entry.status, entry.name);
        assert.ok(result.body);
      }
      return;
    }
    const base = fixtureConfig();
    const config = {
      ...base,
      local: true,
      runtimeMode: 'm0-local',
      auth: undefined,
      hosting: undefined,
      apiOrigin: mock.url,
      applicationToken: 'synthetic-cdc-app-token',
      operatorToken: 'synthetic-cdc-operator-token',
    };
    for (const entry of cases) {
      // Execute the real BFF forwarding code as the consumer of the API.
      const request = new Request(base.publicOrigin + entry.path, {
        method: entry.method,
        headers: {
          Origin: base.publicOrigin,
          Accept: 'application/json',
          ...(entry.key
            ? {
                'Idempotency-Key': entry.key,
                'Content-Type': 'application/json',
              }
            : {}),
        },
        ...(entry.body ? { body: JSON.stringify(entry.body) } : {}),
      });
      const response = await forward(
        request,
        entry.path.slice('/api/'.length).split('/'),
        { config },
      );
      assert.equal(
        response.status,
        entry.status,
        entry.name + ': ' + (await response.text()),
      );
    }
  });
  console.log(
    'Consumer contract recorded: ' +
      boundary.consumer +
      ' -> ' +
      boundary.provider +
      ' (' +
      cases.length +
      ' interactions).',
  );
}
