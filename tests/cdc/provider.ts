import { assertPactSourceVersion } from './broker.js';
import assert from 'node:assert/strict';
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadPactEnvironment } from '../../config/environment.mjs';
import { once } from 'node:events';
import { Verifier } from '@pact-foundation/pact';
import { apiContract } from '@ai-runtime/contracts/http';
import { createApplication } from '../../apps/api/dist/bootstrap.js';
import { loadConfig } from '../../apps/api/src/infrastructure/config/environment-config.js';
import { createDatabaseClient } from '../../apps/api/src/infrastructure/database/client.js';
import { seedDatabase } from '../../apps/api/src/infrastructure/database/seed.js';
import { forward } from '../../apps/web/src/server/api-gateway/forward';
import { fixtureConfig } from '../../apps/web/test/fixtures';
import { input, sampleId } from './expectations';

export async function verifyProviders(
  mode: 'local' | 'broker' | 'proof' = 'local',
) {
  const broker = mode === 'local' ? undefined : loadPactEnvironment();
  if (broker) {
    assertPactSourceVersion();
  }
  if (
    mode === 'proof' &&
    (!broker?.loopback || broker.environment !== 'contract-ci')
  ) {
    throw new Error(
      'Negative Broker proof is restricted to the disposable loopback contract-ci environment.',
    );
  }
  function contractSource(
    provider: string,
    consumer: string,
    negative = false,
  ) {
    return broker
      ? {
          pactBrokerUrl: broker.url,
          pactBrokerToken: broker.token,
          providerVersion:
            broker.version + (negative ? '-incompatible-probe' : ''),
          providerVersionBranch: broker.branch,
          publishVerificationResult: true,
          consumerVersionSelectors: [
            { branch: broker.branch },
            { deployedOrReleased: true },
            { branch: 'contract-baseline' },
          ],
          enablePending: false,
          failIfNoPactsFound: true,
        }
      : {
          pactUrls: [
            resolve(
              '.local/pacts/current',
              consumer + '-' + provider + '.json',
            ),
            resolve(
              'tests/cdc/baselines/v1',
              consumer + '-' + provider + '.json',
            ),
          ],
        };
  }
  const source = loadConfig();
  assert.equal(
    source.runtimeMode,
    'm0-local',
    'CDC must use the explicitly configured local test database.',
  );
  const fixturePrefix = 'cdc-' + randomUUID();
  const config = {
    ...source,
    applications: source.applications.map((app, index) => ({
      ...app,
      id: fixturePrefix + '-' + index,
      name: 'CDC fixture',
      token: randomBytes(32).toString('hex'),
    })),
  };
  const ids = config.applications.map((item) => item.id);
  const database = createDatabaseClient(config);
  let application: Awaited<ReturnType<typeof createApplication>> | undefined;
  let failHealth = false;
  let apiOrigin = '';
  let bffOrigin = '';
  const bff = createServer(async (incoming, outgoing) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of incoming) {
        chunks.push(Buffer.from(chunk));
      }
      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) {
        if (value !== undefined) {
          headers.set(name, Array.isArray(value) ? value.join(',') : value);
        }
      }
      const body = Buffer.concat(chunks).toString('utf8');
      const request = new Request(bffOrigin + incoming.url, {
        method: incoming.method,
        headers,
        ...(body ? { body } : {}),
      });
      const base = fixtureConfig();
      const runtime = {
        config: {
          ...base,
          local: true,
          runtimeMode: 'm0-local',
          auth: undefined,
          hosting: undefined,
          publicOrigin: bffOrigin,
          allowedOrigins: [bffOrigin],
          apiOrigin,
          applicationToken: config.applications[0]!.token,
          operatorToken: config.localOperatorToken,
          responseLimitBytes: 2097152,
        },
      };
      const response = await forward(
        request,
        new URL(request.url).pathname.slice('/api/'.length).split('/'),
        runtime,
      );
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      const text = await response.text();
      if (failHealth && incoming.url === apiContract.lab.health.path) {
        const invalid = JSON.parse(text);
        delete invalid.saved_checks;
        outgoing.end(JSON.stringify(invalid));
      } else {
        outgoing.end(text);
      }
    } catch {
      outgoing.writeHead(503, { 'Content-Type': 'application/json' });
      outgoing.end(
        JSON.stringify({
          error: {
            code: 'TEST_HARNESS_ERROR',
            message: 'Test harness failed.',
          },
        }),
      );
    }
  });
  try {
    await seedDatabase(database, config);
    // Only this test's application profiles are restricted. Existing project data is untouched.
    await database.profile.deleteMany({
      where: {
        applicationId: { in: ids },
        profileRef: { not: 'chat-default@1' },
      },
    });
    application = await createApplication(config);
    await application.listen(0, '127.0.0.1');
    apiOrigin = await application.getUrl();
    bff.listen(0, '127.0.0.1');
    await once(bff, 'listening');
    const address = bff.address();
    assert.ok(address && typeof address !== 'string');
    bffOrigin = 'http://127.0.0.1:' + address.port;
    const stateHandlers = {
      'isolated platform fixtures': async () => {
        await database.contractCheck.deleteMany({
          where: { applicationId: ids[0] },
        });
        const response = await application!.inject({
          method: apiContract.lab.validate.method,
          url: apiContract.lab.validate.path,
          headers: {
            host: config.apiHost,
            authorization: 'Bearer ' + config.applications[0]!.token,
            'idempotency-key': 'cdc-replay',
          },
          payload: input,
        });
        assert.equal(response.statusCode, 201, response.body);
        assert.equal(
          await database.contractCheck.findUnique({ where: { id: sampleId } }),
          null,
          'Reserved fixture UUID already exists; refusing to overwrite it.',
        );
        await database.contractCheck.update({
          where: { id: response.json().id },
          data: { id: sampleId },
        });
        return { recordId: sampleId };
      },
    };
    for (const provider of ['runtime-api', 'runtime-bff']) {
      const baseUrl = provider === 'runtime-api' ? apiOrigin : bffOrigin;
      const consumer =
        provider === 'runtime-api' ? 'runtime-bff' : 'runtime-console';
      await new Verifier({
        provider,
        providerBaseUrl: baseUrl,
        logLevel: 'error',
        ...contractSource(provider, consumer),
        stateHandlers,
        requestFilter: (
          request: IncomingMessage,
          _response: ServerResponse,
          next: () => void,
        ) => {
          if (provider === 'runtime-api') {
            request.headers.authorization =
              'Bearer ' +
              (request.url?.startsWith('/api/m0/')
                ? config.applications[0]!.token
                : config.localOperatorToken);
          } else {
            request.headers.origin = bffOrigin;
            request.headers.host = new URL(bffOrigin).host;
          }
          next();
        },
      }).verifyProvider();
      console.log('Verified actual provider: ' + provider);
    }
    if (mode === 'broker') {
      return;
    }
    failHealth = true;
    await assert.rejects(
      new Verifier({
        provider: 'runtime-bff',
        providerBaseUrl: bffOrigin,
        logLevel: 'error',
        ...contractSource('runtime-bff', 'runtime-console', true),
        stateHandlers,
        requestFilter: (
          request: IncomingMessage,
          _response: ServerResponse,
          next: () => void,
        ) => {
          request.headers.origin = bffOrigin;
          request.headers.host = new URL(bffOrigin).host;
          next();
        },
      }).verifyProvider(),
      (error: unknown) =>
        error instanceof Error && error.message.includes('saved_checks'),
    );
    console.log('Negative CDC proof PASS: removing saved_checks is rejected.');
  } finally {
    if (bff.listening) {
      await new Promise<void>((accept, reject) =>
        bff.close((error) => (error ? reject(error) : accept())),
      );
    }
    await application?.close();
    await database.contractCheck.deleteMany({
      where: { applicationId: { in: ids } },
    });
    await database.profile.deleteMany({
      where: { applicationId: { in: ids } },
    });
    await database.application.deleteMany({ where: { id: { in: ids } } });
    await database.controlApplication.deleteMany({
      where: { id: { in: ids } },
    });
    await database.$disconnect();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const mode = process.argv[2] === '--broker' ? 'broker' : 'local';
  await verifyProviders(mode);
}
