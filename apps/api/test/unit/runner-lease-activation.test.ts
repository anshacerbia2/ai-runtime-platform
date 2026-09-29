import { randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import type { RunnerLeaseCommand } from '@ai-runtime/contracts/http';
import { RunnerLeaseService } from '../../src/modules/control-plane/application/runner-lease.service.js';
import type {
  RunnerLeaseAuthority,
  RunnerLeaseStatus,
} from '../../src/modules/control-plane/application/runner-lease-authority.port.js';
import { InMemoryRunnerLeaseStore } from '../../src/modules/control-plane/infrastructure/in-memory-runner-lease.store.js';
import { InMemoryRunnerPresenceStore } from '../../src/modules/control-plane/infrastructure/in-memory-runner-presence.store.js';
import type { Principal } from '../../src/modules/identity/domain/principal.js';
import { ApplicationError } from '../../src/shared/domain/application-error.js';

const principal: Principal = {
  subject: 'runner:lease-owner',
  kind: 'runner',
  roles: ['runtime-runner'],
  scopes: ['runner:report'],
};
const registration = {
  runnerId: 'runner:lease-node',
  ownerSubject: principal.subject,
  registrationRevision: 2,
};
const command: RunnerLeaseCommand = {
  bootId: randomUUID(),
  registrationRevision: registration.registrationRevision,
  nonce: randomBytes(32).toString('base64url'),
  token: {
    assignmentId: randomUUID(),
    executionId: randomUUID(),
    attemptId: randomUUID(),
    runnerId: registration.runnerId,
    generation: 1,
    epoch: 1,
  },
};

test('an unconfirmed Redis install can be retried, but a confirmed lost lease cannot be reinstalled', async () => {
  let now = 1_000;
  const presence = new InMemoryRunnerPresenceStore(() => now);
  const leases = new InMemoryRunnerLeaseStore(() => now);
  await presence.heartbeat({ ...registration, bootId: command.bootId }, 15_000);
  let status: RunnerLeaseStatus = 'UNINITIALIZED';
  let failConfirm = true;
  let confirmations = 0;
  const authority: RunnerLeaseAuthority = {
    async status() {
      return status;
    },
    async confirm() {
      confirmations += 1;
      if (failConfirm) {
        throw new Error('PostgreSQL commit failed');
      }
      status = 'CURRENT';
    },
  };
  const service = new RunnerLeaseService(
    {
      async authorizeHeartbeat() {
        return registration;
      },
    },
    presence,
    leases,
    authority,
  );
  const proof = {
    ...command.token,
    ownerSubject: principal.subject,
    nonce: command.nonce,
  };

  await assert.rejects(
    service.activate(principal, command),
    /PostgreSQL commit failed/,
  );
  assert.equal(await leases.inspect(proof), 'CURRENT');
  assert.equal(status, 'UNINITIALIZED');

  failConfirm = false;
  assert.equal((await service.activate(principal, command)).state, 'ACTIVE');
  assert.equal(confirmations, 2);
  now += 15_000;
  await presence.heartbeat({ ...registration, bootId: command.bootId }, 15_000);
  await assert.rejects(
    service.activate(principal, command),
    (error: unknown) =>
      error instanceof ApplicationError && error.code === 'STALE_ASSIGNMENT',
  );
  assert.equal(await leases.inspect(proof), 'MISSING');
  assert.equal(confirmations, 2);
});
