export interface QuerySnapshot<T> {
  data: T;
  checkedAt: number;
}

export type QueryState<T> =
  | { status: 'idle' }
  | { status: 'loading'; previous?: QuerySnapshot<T> }
  | { status: 'success'; snapshot: QuerySnapshot<T> }
  | { status: 'error'; error: Error; previous?: QuerySnapshot<T> };

export function latestSnapshot<T>(
  state: QueryState<T>,
): QuerySnapshot<T> | undefined {
  if (state.status === 'success') {
    return state.snapshot;
  }
  return state.status === 'idle' ? undefined : state.previous;
}
