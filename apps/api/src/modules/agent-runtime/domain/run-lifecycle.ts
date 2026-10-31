// Agent Run lifecycle. Prospective and internal: it does not extend the public
// ExecutionStatus, and stop reasons and pending reconciliation are separate
// facts (ADR-0034).
export const runStatuses = [
  'CREATED',
  'RUNNING',
  'WAITING_TOOL',
  'WAITING_HUMAN',
  'SUSPENDED',
  'COMPLETED',
  'CANCELLED',
  'FAILED',
  'STOPPED_BUDGET',
] as const;

export type RunStatus = (typeof runStatuses)[number];

const stops = ['CANCELLED', 'FAILED', 'STOPPED_BUDGET'] as const;

const transitions: Readonly<Record<RunStatus, readonly RunStatus[]>> = {
  CREATED: ['RUNNING', 'CANCELLED', 'FAILED'],
  RUNNING: [
    'WAITING_TOOL',
    'WAITING_HUMAN',
    'SUSPENDED',
    'COMPLETED',
    ...stops,
  ],
  WAITING_TOOL: ['RUNNING', 'SUSPENDED', ...stops],
  WAITING_HUMAN: ['RUNNING', ...stops],
  SUSPENDED: ['RUNNING', ...stops],
  COMPLETED: [],
  CANCELLED: [],
  FAILED: [],
  STOPPED_BUDGET: [],
};

export function canTransitionRun(from: RunStatus, to: RunStatus): boolean {
  return transitions[from].includes(to);
}

export function isRunTerminal(status: RunStatus): boolean {
  return transitions[status].length === 0;
}

// A committed cancel intent closes the admission gate even before the Run
// reaches CANCELLED; work admitted earlier may still finish as late evidence.
export function admitsNewOperation(
  status: RunStatus,
  cancelRequested: boolean,
): boolean {
  return status === 'RUNNING' && !cancelRequested;
}
