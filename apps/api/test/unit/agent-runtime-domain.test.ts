import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canTransitionOperation,
  isOperationResolved,
  operationStates,
  provesNoEffect,
  recoveryAction,
} from '../../src/modules/agent-runtime/domain/operation-state.js';
import {
  admitsNewOperation,
  canTransitionRun,
  isRunTerminal,
  runStatuses,
} from '../../src/modules/agent-runtime/domain/run-lifecycle.js';

test('an operation crosses the dispatch boundary only from PREPARED', () => {
  for (const from of operationStates) {
    assert.equal(
      canTransitionOperation(from, 'DISPATCHING'),
      from === 'PREPARED',
      from,
    );
  }
});

test('resolved operations never change again', () => {
  for (const from of ['SUCCEEDED', 'NO_EFFECT', 'FAILED'] as const) {
    assert.ok(isOperationResolved(from));
    for (const to of operationStates) {
      assert.equal(canTransitionOperation(from, to), false, `${from}->${to}`);
    }
  }
  for (const open of ['PREPARED', 'DISPATCHING', 'UNKNOWN'] as const) {
    assert.equal(isOperationResolved(open), false);
  }
});

test('UNKNOWN cannot fall back to a fresh dispatch', () => {
  assert.equal(canTransitionOperation('UNKNOWN', 'PREPARED'), false);
  assert.equal(canTransitionOperation('UNKNOWN', 'DISPATCHING'), false);
  assert.equal(canTransitionOperation('DISPATCHING', 'PREPARED'), false);
});

test('only NO_EFFECT proves absence of effect; FAILED does not', () => {
  for (const state of operationStates) {
    assert.equal(provesNoEffect(state), state === 'NO_EFFECT', state);
  }
});

test('restart after the dispatch boundary is status-only, never redispatch', () => {
  assert.equal(
    recoveryAction('PREPARED'),
    'revalidate_then_compete_for_dispatch',
  );
  assert.equal(recoveryAction('DISPATCHING'), 'status_only_or_suspend');
  assert.equal(recoveryAction('UNKNOWN'), 'status_only_or_suspend');
  for (const state of ['SUCCEEDED', 'NO_EFFECT', 'FAILED'] as const) {
    assert.equal(recoveryAction(state), 'none');
  }
});

test('terminal Runs are final and only RUNNING completes', () => {
  for (const status of runStatuses) {
    assert.equal(
      canTransitionRun(status, 'COMPLETED'),
      status === 'RUNNING',
      status,
    );
  }
  for (const status of [
    'COMPLETED',
    'CANCELLED',
    'FAILED',
    'STOPPED_BUDGET',
  ] as const) {
    assert.ok(isRunTerminal(status));
    for (const to of runStatuses) {
      assert.equal(canTransitionRun(status, to), false, `${status}->${to}`);
    }
  }
});

test('every non-terminal Run can still be cancelled', () => {
  for (const status of runStatuses) {
    assert.equal(
      canTransitionRun(status, 'CANCELLED'),
      !isRunTerminal(status),
      status,
    );
  }
});

test('cancel intent closes admission before the Run is terminal', () => {
  assert.ok(admitsNewOperation('RUNNING', false));
  assert.equal(admitsNewOperation('RUNNING', true), false);
  for (const status of runStatuses.filter((s) => s !== 'RUNNING')) {
    assert.equal(admitsNewOperation(status, false), false, status);
  }
});
