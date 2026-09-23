import { labClient } from '../../shared/api/lab-client';
import { latestSnapshot } from '../../shared/api/query-state';
import { useResourceQuery } from '../../shared/api/use-resource-query';

/** Catalogue orchestration only; health and editor mutations have separate lifecycles. */
export function useWorkspace() {
  const { state, refresh } = useResourceQuery(labClient.catalogue);
  return {
    catalogue: state,
    resources: latestSnapshot(state)?.data,
    refreshCatalogue: refresh,
  };
}
