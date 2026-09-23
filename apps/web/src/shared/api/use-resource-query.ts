'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { isRequestAborted, toError } from './http-error';
import { latestSnapshot, type QueryState } from './query-state';

/** One query lifecycle. New requests cancel older ones; failure never means health is offline. */
export function useResourceQuery<T>(
  load: (signal?: AbortSignal) => Promise<T>,
) {
  const [state, setState] = useState<QueryState<T>>({ status: 'idle' });
  const mounted = useRef(false);
  const controller = useRef<AbortController | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
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
      const data = await load(active.signal);
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
        if (isRequestAborted(cause)) {
          return previous
            ? { status: 'success', snapshot: previous }
            : { status: 'idle' };
        }
        return { status: 'error', error: toError(cause), previous };
      });
    }
  }, [load]);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => {
      mounted.current = false;
      controller.current?.abort();
    };
  }, [refresh]);

  return { state, refresh };
}
