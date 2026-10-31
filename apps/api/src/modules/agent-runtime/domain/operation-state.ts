// State of one external operation (model Turn or Tool call) owned by an Agent
// Run. Internal to Agent Runtime; existing ToolEffect and Execution states keep
// their own meaning and are mapped by adapters, never renamed (ADR-0034).
export const operationStates = [
  'PREPARED',
  'DISPATCHING',
  'UNKNOWN',
  'SUCCEEDED',
  'NO_EFFECT',
  'FAILED',
] as const;

export type OperationState = (typeof operationStates)[number];

const transitions: Readonly<Record<OperationState, readonly OperationState[]>> =
  {
    // NO_EFFECT from PREPARED: abandoned before the durable dispatch boundary,
    // so nothing was sent.
    PREPARED: ['DISPATCHING', 'NO_EFFECT'],
    DISPATCHING: ['UNKNOWN', 'SUCCEEDED', 'NO_EFFECT', 'FAILED'],
    UNKNOWN: ['SUCCEEDED', 'NO_EFFECT', 'FAILED'],
    SUCCEEDED: [],
    NO_EFFECT: [],
    FAILED: [],
  };

export function canTransitionOperation(
  from: OperationState,
  to: OperationState,
): boolean {
  return transitions[from].includes(to);
}

export function isOperationResolved(state: OperationState): boolean {
  return transitions[state].length === 0;
}

// Only proven absence of effect counts. FAILED alone never means no side
// effect or no cost.
export function provesNoEffect(state: OperationState): boolean {
  return state === 'NO_EFFECT';
}

export type RecoveryAction =
  'revalidate_then_compete_for_dispatch' | 'status_only_or_suspend' | 'none';

// What a restarted coordinator may do with an operation it finds. Progress
// recovery and operation replay are separate permissions: once the dispatch
// boundary is crossed, the only permitted action is a non-dispatching status
// read under the original identity. There is deliberately no 'redispatch'.
export function recoveryAction(state: OperationState): RecoveryAction {
  if (state === 'PREPARED') {
    return 'revalidate_then_compete_for_dispatch';
  }
  if (state === 'DISPATCHING' || state === 'UNKNOWN') {
    return 'status_only_or_suspend';
  }
  return 'none';
}
