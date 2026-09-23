import { Button } from '../../design-system/primitives/button';
import { ApiClientError, errorMessage } from '../api/http-error';
import type { QueryState } from '../api/query-state';

export function QueryFeedback({
  state,
  label,
  onRetry,
}: {
  state: QueryState<unknown>;
  label: string;
  onRetry(): Promise<void>;
}) {
  if (state.status === 'loading' || state.status === 'idle') {
    return (
      <div role="status" className="ds-loading-state">
        Loading {label}…
      </div>
    );
  }
  if (state.status !== 'error') {
    return null;
  }
  const requestId =
    state.error instanceof ApiClientError ? state.error.requestId : undefined;
  return (
    <div className="error-banner" role="alert">
      <span>
        {label}: {errorMessage(state.error)}
      </span>
      {requestId ? <code>Request: {requestId}</code> : null}
      <Button size="sm" onClick={() => void onRetry()}>
        Retry {label}
      </Button>
    </div>
  );
}
