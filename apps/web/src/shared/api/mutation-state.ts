export type MutationState<T> =
  | { status: 'idle' }
  | { status: 'pending'; operation: number }
  | { status: 'success'; operation: number; data: T }
  | { status: 'error' | 'unknown'; operation: number; error: Error };

export type MutationCompletion<T> = Exclude<
  MutationState<T>,
  { status: 'idle' } | { status: 'pending' }
>;

/** Only the currently pending operation may publish a result. */
export function completeMutation<T>(
  state: MutationState<T>,
  next: MutationCompletion<T>,
): MutationState<T> {
  return state.status === 'pending' && state.operation === next.operation
    ? next
    : state;
}
