'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useWorkspace } from '../workspace/use-workspace';
import { ContractLabPage } from './contract-lab-page';
import { LabStatusOverview } from './components/lab-status-overview';
import { PageHeader } from '../../design-system/compositions/page-header';
import { ErrorBanner } from '../../shared/ui/error-banner';
import { QueryFeedback } from '../../shared/ui/query-feedback';
import { labClient } from '../../shared/api/lab-client';
import { errorMessage } from '../../shared/api/http-error';
import { useResourceQuery } from '../../shared/api/use-resource-query';

export function ContractLabScreen() {
  const router = useRouter();
  const { resources, catalogue, refreshCatalogue } = useWorkspace();
  const { state: health, refresh: refreshHealth } = useResourceQuery(
    labClient.health,
  );
  const [operationError, setOperationError] = useState<Error | null>(null);

  return (
    <>
      <PageHeader
        eyebrow="Engineering workbench"
        title="Contract Lab"
        description="Validate application requests against the canonical contract before any provider or runtime is involved."
      />
      <LabStatusOverview state={health} onRefresh={refreshHealth} />
      <ErrorBanner
        message={operationError ? errorMessage(operationError) : ''}
        onDismiss={() => setOperationError(null)}
      />
      <QueryFeedback
        state={catalogue}
        label="catalogue"
        onRetry={refreshCatalogue}
      />
      {resources ? (
        <ContractLabPage
          resources={resources}
          onSaved={refreshHealth}
          onHistory={() => router.push('/history')}
          onError={setOperationError}
        />
      ) : null}
    </>
  );
}
