import type { StatusMetric } from '../../design-system/components/status-overview';
import type { LabHealth } from '../../shared/api/lab-client';
import { ApiClientError } from '../../shared/api/http-error';
import { latestSnapshot, type QueryState } from '../../shared/api/query-state';

export function labStatusMetrics(state: QueryState<LabHealth>): StatusMetric[] {
  const snapshot = latestSnapshot(state);
  const ready = state.status === 'success';
  const loading = state.status === 'loading';
  const error = state.status === 'error' ? state.error : undefined;
  const status = error instanceof ApiClientError ? error.status : null;
  const apiValue = ready
    ? 'Healthy'
    : loading
      ? 'Checking'
      : status === 401
        ? 'Sign-in required'
        : status === 403
          ? 'Access denied'
          : 'Unconfirmed';
  const checked = snapshot
    ? 'Last checked ' + new Date(snapshot.checkedAt).toLocaleTimeString()
    : 'Not yet verified';

  return [
    {
      label: 'API',
      value: apiValue,
      detail: ready ? 'NestJS / Fastify · ' + checked : checked,
      badge: ready ? 'Online' : loading ? 'Pending' : 'Unknown',
      tone: ready ? 'success' : 'warning',
    },
    {
      label: 'Database',
      value: ready ? 'Available' : 'Unknown',
      detail: ready
        ? snapshot!.data.database + ' · ' + checked
        : 'No current database verification',
      badge: ready ? 'Checked' : 'Unknown',
      tone: ready ? 'success' : 'neutral',
    },
    {
      label: 'Validations',
      value: snapshot?.data.saved_checks ?? '—',
      valueTestId: 'saved-count',
      detail: snapshot?.data.application_id ?? 'Application not yet verified',
      badge: ready ? 'records' : snapshot ? 'Last known' : 'Unknown',
      tone: ready ? 'neutral' : 'warning',
    },
    {
      label: 'Provider calls',
      value: snapshot?.data.provider_calls ?? '—',
      detail: 'Execution disabled in Contract Lab',
      badge: ready ? 'By design' : snapshot ? 'Last known' : 'Not measured',
      tone: 'info',
    },
  ];
}
