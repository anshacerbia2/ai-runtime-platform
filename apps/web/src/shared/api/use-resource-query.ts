'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toError } from './http-error';
import { latestSnapshot, type QueryState } from './query-state';

/** One query lifecycle. New requests cancel older ones; failure never means health is offline. */
export function useResourceQuery<T>(
  load: (signal?: AbortSignal) => Promise<T>,
) {
  const [state, setState] = useState<QueryState<T>>({ status: 'idle' });

  const mounted = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const loadRef = useRef(load);

  loadRef.current = load;

  const runRefresh = useCallback(
    async (rejectOnError = false): Promise<void> => {
      if (!mounted.current) {
        return;
      }
      controller.current?.abort();
      const active = new AbortController();
      controller.current = active;
      setState((current) => ({
        status: 'loading',
        previous: latestSnapshot(current),
      }));

      try {
        const data = await loadRef.current(active.signal);
        if (
          mounted.current &&
          controller.current === active &&
          !active.signal.aborted
        ) {
          setState({
            status: 'success',
            snapshot: { data, checkedAt: Date.now() },
          });
        }
      } catch (cause) {
        if (
          !mounted.current ||
          controller.current !== active ||
          active.signal.aborted
        ) {
          return;
        }
        setState((current) => {
          const previous = latestSnapshot(current);
          // Owned cancellation was handled above. An unrelated transport abort
          // is not a new successful observation of this resource.
          return { status: 'error', error: toError(cause), previous };
        });
        if (rejectOnError) {
          throw toError(cause);
        }
      }
    },
    [],
  );

  const refresh = useCallback(() => runRefresh(), [runRefresh]);
  const refreshOrThrow = useCallback(() => runRefresh(true), [runRefresh]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort();
    };
  }, []);

  useEffect(() => {
    void runRefresh();
    return () => {
      controller.current?.abort();
    };
  }, [load, runRefresh]);

  return { state, refresh, refreshOrThrow };
}
