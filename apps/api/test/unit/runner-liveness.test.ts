import { randomUUID } from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { ApplicationError } from '../../src/shared/domain/application-error.js';
import type { Principal } from '../../src/modules/identity/domain/principal.js';
import type {
  RunnerLivenessRegistry,
  RunnerRegistrationIdentity,
} from '../../src/modules/control-plane/application/runner-liveness-registry.port.js';
import type {
  RunnerPresenceProof,
  RunnerPresenceStore,
} from '../../src/modules/control-plane/application/runner-presence-store.port.js';
import { RunnerLivenessService } from '../../src/modules/control-plane/application/runner-liveness.service.js';
import { InMemoryRunnerPresenceStore } from '../../src/modules/control-plane/infrastructure/in-memory-runner-presence.store.js';

const principal: Principal = {
  subject: 'runner:test-owner',
  kind: 'runner',
  scopes: ['runner:register'],
  roles: [],
};
const registration: RunnerRegistrationIdentity = {
  runnerId: 'local:runner-node_104',
  ownerSubject: principal.subject,
  registrationRevision: 4,
};
const input = {
  runnerId: registration.runnerId,
  bootId: randomUUID(),
  registrationRevision: registration.registrationRevision,
};

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

test('authorized heartbeat publishes a bounded hot presence proof', async () => {
  let published: { proof: RunnerPresenceProof; ttlMs: number } | undefined;
  const presence: RunnerPresenceStore = {
    async heartbeat(proof, ttlMs) {
      published = { proof, ttlMs };
    },
    async inspect() {
      return 'CURRENT';
    },
  };
  const service = new RunnerLivenessService(new Registry(), presence);
  assert.deepEqual(await service.heartbeat(principal, input), {
    ...input,
    state: 'ALIVE',
    heartbeatIntervalMs: 5_000,
    presenceTtlMs: 15_000,
  });
  assert.deepEqual(published, {
    proof: { ...registration, bootId: input.bootId },
    ttlMs: 15_000,
  });
});

test('heartbeat rejects wrong principal kind before registry or Redis access', async () => {
  let accessed = false;
  const service = new RunnerLivenessService(
    {
      async authorizeHeartbeat() {
        accessed = true;
        return registration;
      },
    },
    {
      async heartbeat() {
        accessed = true;
      },
      async inspect() {
        accessed = true;
        return 'CURRENT';
      },
    },
  );
  await assert.rejects(
    service.heartbeat(
      { subject: 'app', kind: 'application', scopes: [], roles: [] },
      input,
    ),
    (error: unknown) =>
      error instanceof ApplicationError && error.code === 'POLICY_DENIED',
  );
  assert.equal(accessed, false);
});

test('coordination outage fails heartbeat closed with a retryable dependency error', async () => {
  const service = new RunnerLivenessService(new Registry(), {
    async heartbeat() {
      throw new Error('redis unavailable');
    },
    async inspect() {
      throw new Error('redis unavailable');
    },
  });
  await assert.rejects(
    service.heartbeat(principal, input),
    (error: unknown) =>
      error instanceof ApplicationError &&
      error.code === 'DEPENDENCY_UNAVAILABLE',
  );
});

test('presence is current only for the durable registration revision and expires to missing', async () => {
  let now = 1_000;
  const store = new InMemoryRunnerPresenceStore(() => now);
  await store.heartbeat({ ...registration, bootId: input.bootId }, 15_000);
  assert.equal(await store.inspect(registration), 'CURRENT');
  assert.equal(
    await store.inspect({ ...registration, registrationRevision: 5 }),
    'MISMATCH',
  );
  assert.equal(
    await store.inspect({ ...registration, ownerSubject: 'runner:other' }),
    'MISMATCH',
  );
  now += 15_000;
  assert.equal(await store.inspect(registration), 'MISSING');
});
