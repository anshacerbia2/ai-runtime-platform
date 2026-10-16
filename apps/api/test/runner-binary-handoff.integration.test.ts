import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import type { Principal } from '../src/modules/identity/domain/principal.js';
import { RuntimeConfigModule } from '../dist/infrastructure/config/runtime-config.module.js';
import { loadConfig } from '../dist/infrastructure/config/environment-config.js';
import { IdentityModule } from '../dist/modules/identity/identity.module.js';
import { LocalAuthGuard } from '../dist/modules/identity/presentation/http/local-auth.guard.js';
import { HttpExceptionFilter } from '../dist/shared/presentation/http-exception.filter.js';
import {
  RUNNER_PAYLOAD_HANDOFF,
  RunnerPayloadHandoffController,
  type RunnerPayloadHandoff,
} from '../dist/modules/dispatch-envelope/presentation/http/runner-payload-handoff.controller.js';
import {
  RUNNER_PLUGIN_HANDOFF,
  RunnerPluginHandoffController,
  type RunnerPluginHandoff,
} from '../dist/modules/plugin-registry/presentation/http/runner-plugin-handoff.controller.js';

const config = {
  ...loadConfig(),
  localRunnerToken: randomUUID(),
  localOperatorToken: randomUUID(),
  applications: [
    {
      id: `handoff-${randomUUID()}`,
      name: 'Handoff fixture',
      token: randomUUID(),
    },
  ],
};
const command = {
  token: {
    assignmentId: randomUUID(),
    executionId: randomUUID(),
    attemptId: randomUUID(),
    runnerId: 'runner-handoff-fixture',
    generation: 1,
    epoch: 1,
  },
  bootId: randomUUID(),
  registrationRevision: 1,
  nonce: randomBytes(32).toString('base64url'),
  envelopeId: randomUUID(),
};
const route = '/api/runner/v1/dispatches/payload';
const pluginRoute = '/api/runner/v1/dispatches/plugin';

test('runner binary handoffs require machine authority and send bounded non-cacheable bytes', async () => {
  let calls = 0;
  let supplied: Uint8Array | undefined;
  let reject = false;
  let responseBytes = Uint8Array.from([0, 1, 2, 255]);
  const delivery: RunnerPayloadHandoff = {
    async read(principal: Principal, request, envelopeId) {
      calls++;
      assert.equal(principal.subject, 'local-runner');
      assert.equal(envelopeId, command.envelopeId);
      const { envelopeId: _envelopeId, ...leaseCommand } = command;
      assert.deepEqual(request, leaseCommand);
      if (reject) {
        throw new Error('stale private storage detail');
      }
      supplied = responseBytes;
      return supplied;
    },
  };
  let pluginCalls = 0;
  let pluginBytes = Uint8Array.from([7, 8, 9]);
  let pluginReject = false;
  const pluginDelivery: RunnerPluginHandoff = {
    async read(principal, request, envelopeId) {
      pluginCalls++;
      assert.equal(principal.subject, 'local-runner');
      assert.equal(envelopeId, command.envelopeId);
      const { envelopeId: _envelopeId, ...leaseCommand } = command;
      assert.deepEqual(request, leaseCommand);
      if (pluginReject) {
        throw new Error('private signer detail');
      }
      return pluginBytes;
    },
  };
  class HandoffTestModule {}
  Module({
    imports: [RuntimeConfigModule.register(config), IdentityModule],
    controllers: [
      RunnerPayloadHandoffController,
      RunnerPluginHandoffController,
    ],
    providers: [
      { provide: RUNNER_PAYLOAD_HANDOFF, useValue: delivery },
      { provide: RUNNER_PLUGIN_HANDOFF, useValue: pluginDelivery },
      { provide: APP_GUARD, useClass: LocalAuthGuard },
      { provide: APP_FILTER, useClass: HttpExceptionFilter },
    ],
  })(HandoffTestModule);
  const app = await NestFactory.create<NestFastifyApplication>(
    HandoffTestModule,
    new FastifyAdapter({ bodyLimit: 65_536, logger: false }),
    { logger: false },
  );
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  const send = (token: string, payload: object = command) =>
    app.inject({
      method: 'POST',
      url: route,
      payload,
      headers: {
        authorization: `Bearer ${token}`,
        'x-runner-protocol': '1',
      },
    });
  const sendPlugin = (token: string, payload: object = command) =>
    app.inject({
      method: 'POST',
      url: pluginRoute,
      payload,
      headers: {
        authorization: `Bearer ${token}`,
        'x-runner-protocol': '1',
      },
    });
  try {
    const unauthenticated = await send('invalid');
    assert.equal(unauthenticated.statusCode, 401);
    const operator = await send(config.localOperatorToken);
    assert.equal(operator.statusCode, 403);
    const malformed = await send(config.localRunnerToken, {
      ...command,
      envelopeId: randomUUID(),
      objectKey: 'caller-selected',
    });
    assert.equal(malformed.statusCode, 400);
    assert.equal(calls, 0);

    const wrongProtocol = await app.inject({
      method: 'POST',
      url: route,
      payload: command,
      headers: {
        authorization: `Bearer ${config.localRunnerToken}`,
        'x-runner-protocol': '2',
      },
    });
    assert.equal(wrongProtocol.statusCode, 400);
    assert.equal(calls, 0);

    const response = await send(config.localRunnerToken);
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.headers['content-type'], 'application/octet-stream');
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.deepEqual(response.rawPayload, Buffer.from([0, 1, 2, 255]));
    assert.ok(supplied?.every((byte) => byte === 0));
    assert.equal(calls, 1);

    responseBytes = new Uint8Array(1_048_577).fill(7);
    const oversized = await send(config.localRunnerToken);
    assert.equal(oversized.statusCode, 503);
    assert.ok(responseBytes.every((byte) => byte === 0));
    assert.equal(
      oversized.headers['content-type'],
      'application/json; charset=utf-8',
    );

    reject = true;
    const denied = await send(config.localRunnerToken);
    assert.equal(denied.statusCode, 503);
    assert.doesNotMatch(denied.body, /stale private storage detail/);

    assert.equal((await sendPlugin('invalid')).statusCode, 401);
    assert.equal((await sendPlugin(config.localOperatorToken)).statusCode, 403);
    assert.equal(
      (
        await sendPlugin(config.localRunnerToken, {
          ...command,
          objectKey: 'raw-key',
        })
      ).statusCode,
      400,
    );
    assert.equal(pluginCalls, 0);
    const plugin = await sendPlugin(config.localRunnerToken);
    assert.equal(plugin.statusCode, 200, plugin.body);
    assert.equal(plugin.headers['content-type'], 'application/octet-stream');
    assert.equal(plugin.headers['cache-control'], 'no-store');
    assert.deepEqual(plugin.rawPayload, Buffer.from([7, 8, 9]));
    assert.ok(pluginBytes.every((byte) => byte === 0));
    assert.equal(pluginCalls, 1);

    pluginBytes = new Uint8Array(16_777_217).fill(9);
    const oversizedPlugin = await sendPlugin(config.localRunnerToken);
    assert.equal(oversizedPlugin.statusCode, 503);
    assert.ok(pluginBytes.every((byte) => byte === 0));

    pluginReject = true;
    const pluginDenied = await sendPlugin(config.localRunnerToken);
    assert.equal(pluginDenied.statusCode, 503);
    assert.doesNotMatch(pluginDenied.body, /private signer detail/);
  } finally {
    await app.close();
  }
});
