import test from 'node:test';
import assert from 'node:assert/strict';
import { RunnerCoordinationService } from '../../src/modules/control-plane/application/runner-coordination.service.js';
import type {
  RunnerCoordinationAuthority,
  RunnerCoordinationState,
  RunnerCoordinationStore,
} from '../../src/modules/control-plane/application/runner-coordination.port.js';
import type {
  RunnerLeaseRecovery,
  RunnerLeaseRecoveryCandidate,
} from '../../src/modules/control-plane/application/runner-lease-recovery.port.js';
import { ApplicationError } from '../../src/shared/domain/application-error.js';

const assignment: RunnerLeaseRecoveryCandidate = {
  assignmentId: '00000000-0000-4000-8000-000000000301',
  executionId: '00000000-0000-4000-8000-000000000302',
  proof: null,
};

function harness() {
  let state: RunnerCoordinationState = {
    epoch: 7,
    state: 'ACTIVE',
    marker: '00000000-0000-4000-8000-000000000303',
  };
  let marker: string | null = state.marker;
  let active = true;
  let unavailable = false;
  const reasons: string[] = [];
  const authority: RunnerCoordinationAuthority = {
    async read() {
      return { ...state };
    },
    async pauseIfCurrent(current) {
      if (
        state.state !== 'ACTIVE' ||
        state.epoch !== current.epoch ||
        state.marker !== current.marker
      ) {
        return false;
      }
      state = { ...state, state: 'PAUSED' };
      return true;
    },
    async resume(store) {
      if (state.state !== 'PAUSED' || active) {
        return false;
      }
      const next = '00000000-0000-4000-8000-000000000304';
      await store.write(next);
      state = { epoch: state.epoch + 1, state: 'ACTIVE', marker: next };
      return true;
    },
  };
  const store: RunnerCoordinationStore = {
    async read() {
      if (unavailable) {
        throw new Error('Redis down');
      }
      return marker;
    },
    async write(value) {
      if (unavailable) {
        throw new Error('Redis down');
      }
      marker = value;
    },
  };
  const recovery: RunnerLeaseRecovery = {
    async scan() {
      return [];
    },
    async scanActive() {
      return active ? [assignment] : [];
    },
    async fence(_candidate, reason) {
      reasons.push(reason);
      active = false;
      return true;
    },
  };
  return {
    service: new RunnerCoordinationService(authority, recovery, store),
    state: () => state,
    reasons,
    loseMarker: () => {
      marker = null;
    },
    setUnavailable: (value: boolean) => {
      unavailable = value;
    },
  };
}

test('marker loss pauses dispatch, fences old authority, then opens a new epoch', async () => {
  const run = harness();
  await run.service.assertActive();
  run.loseMarker();
  await assert.rejects(
    run.service.assertActive(),
    (error) =>
      error instanceof ApplicationError &&
      error.code === 'DEPENDENCY_UNAVAILABLE',
  );
  assert.equal(run.state().state, 'PAUSED');
  assert.equal(await run.service.recover(), 1);
  assert.deepEqual(run.reasons, ['EPOCH_LOST']);
  assert.deepEqual(run.state(), {
    epoch: 8,
    state: 'ACTIVE',
    marker: '00000000-0000-4000-8000-000000000304',
  });
  await run.service.assertActive();
});

test('Redis transport failure does not masquerade as epoch loss', async () => {
  const run = harness();
  run.setUnavailable(true);
  await assert.rejects(
    run.service.assertActive(),
    /Runner coordination is unavailable/,
  );
  assert.equal(run.state().state, 'ACTIVE');
  assert.deepEqual(run.reasons, []);
});
