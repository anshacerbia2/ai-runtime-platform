import { randomUUID } from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import type { RunnerDispatchGrant } from '@ai-runtime/contracts/http';
import { RunnerDispatchService } from '../../src/modules/control-plane/application/runner-dispatch.service.js';
import type { RunnerDispatchRepository } from '../../src/modules/control-plane/application/runner-dispatch.port.js';
import type { RunnerLivenessRegistry } from '../../src/modules/control-plane/application/runner-liveness-registry.port.js';
import { InMemoryRunnerPresenceStore } from '../../src/modules/control-plane/infrastructure/in-memory-runner-presence.store.js';
import { ApplicationError } from '../../src/shared/domain/application-error.js';
import type { Principal } from '../../src/modules/identity/domain/principal.js';

const principal: Principal = {
  subject: 'runner:dispatch-owner',
  kind: 'runner',
  roles: ['runtime-runner'],
  scopes: ['runner:register', 'runner:report'],
};
const registration = {
  runnerId: 'runner:dispatch-1',
  ownerSubject: principal.subject,
  registrationRevision: 3,
};
const bootId = randomUUID();
const input = { ...registration, bootId };

class Registry implements RunnerLivenessRegistry {
  async authorizeHeartbeat(
    actor: Principal,
    runnerId: string,
    revision: number,
  ) {
    assert.equal(actor, principal);
    assert.equal(runnerId, registration.runnerId);
    assert.equal(revision, registration.registrationRevision);
    return registration;
  }
}

class Repository implements RunnerDispatchRepository {
  calls = 0;
  constructor(private readonly grant: RunnerDispatchGrant | null) {}
  async claim() {
    this.calls += 1;
    return this.grant;
  }
}

test('dispatch claim requires the exact current runner boot before repository access', async () => {
  const presence = new InMemoryRunnerPresenceStore();
  const repository = new Repository(null);
  const service = new RunnerDispatchService(
    new Registry(),
    presence,
    repository,
  );
  await presence.heartbeat({ ...registration, bootId }, 15_000);

  await assert.rejects(
    service.claim(principal, { ...input, bootId: randomUUID() }),
    (error: unknown) =>
      error instanceof ApplicationError &&
      error.code === 'STALE_RUNNER_REGISTRATION',
  );
  assert.equal(repository.calls, 0);
  assert.deepEqual(await service.claim(principal, input), { grant: null });
  assert.equal(repository.calls, 1);
});

test('dispatch claim fails closed when coordination presence cannot be read', async () => {
  const repository = new Repository(null);
  const service = new RunnerDispatchService(
    new Registry(),
    {
      async heartbeat() {},
      async inspect() {
        throw new Error('redis unavailable');
      },
    },
    repository,
  );
  await assert.rejects(
    service.claim(principal, input),
    (error: unknown) =>
      error instanceof ApplicationError &&
      error.code === 'DEPENDENCY_UNAVAILABLE',
  );
  assert.equal(repository.calls, 0);
});

test('dispatch claim withholds a committed grant when the boot changes during placement', async () => {
  const presence = new InMemoryRunnerPresenceStore();
  await presence.heartbeat({ ...registration, bootId }, 15_000);
  const grant: RunnerDispatchGrant = {
    assignmentId: randomUUID(),
    executionId: randomUUID(),
    attemptId: randomUUID(),
    runnerId: registration.runnerId,
    ownerSubject: registration.ownerSubject,
    generation: 1,
    epoch: 1,
    state: 'GRANTED',
    protocolVersion: '1',
    envelopeId: randomUUID(),
    inputDigest: 'a'.repeat(64),
    plaintextBytes: 1,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    plugin: null,
  };
  const repository: RunnerDispatchRepository = {
    async claim() {
      await presence.heartbeat(
        { ...registration, bootId: randomUUID() },
        15_000,
      );
      return grant;
    },
  };
  const service = new RunnerDispatchService(
    new Registry(),
    presence,
    repository,
  );

  await assert.rejects(
    service.claim(principal, input),
    (error: unknown) =>
      error instanceof ApplicationError &&
      error.code === 'STALE_RUNNER_REGISTRATION',
  );
});
