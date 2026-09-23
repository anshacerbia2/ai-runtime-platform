import type { LabHealth } from '../../../shared/api/lab-client';
import type { QueryState } from '../../../shared/api/query-state';
import { StatusOverview } from '../../../design-system/components/status-overview';
import { Button } from '../../../design-system/primitives/button';
import { QueryFeedback } from '../../../shared/ui/query-feedback';
import { labStatusMetrics } from '../health-status';

export function LabStatusOverview({
  state,
  onRefresh,
}: {
  state: QueryState<LabHealth>;
  onRefresh(): Promise<void>;
}) {
  return (
    <>
      <StatusOverview
        label="Local platform status"
        items={labStatusMetrics(state)}
      />
      {state.status === 'error' ? (
        <QueryFeedback state={state} label="health" onRetry={onRefresh} />
      ) : (
        <Button
          size="sm"
          variant="ghost"
          disabled={state.status === 'loading'}
          onClick={() => void onRefresh()}
        >
          Check health
        </Button>
      )}
    </>
  );
}
