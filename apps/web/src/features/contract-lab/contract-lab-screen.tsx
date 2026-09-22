'use client';
import { useRouter } from 'next/navigation';
import { useWorkspace } from '../workspace/use-workspace';
import { ContractLabPage } from './contract-lab-page';
import { PageHeader } from '../../design-system/compositions/page-header';
import { StatusOverview } from '../../design-system/components/status-overview';
import { ErrorBanner } from '../../shared/ui/error-banner';
export function ContractLabScreen() {
  const router = useRouter();
  const { resources, error, setError, refreshHealth } = useWorkspace();
  return (
    <>
      <PageHeader
        eyebrow="Engineering workbench"
        title="Contract Lab"
        description="Validate application requests against the canonical contract before any provider or runtime is involved."
      />
      <StatusOverview health={resources?.health} />
      <ErrorBanner message={error} onDismiss={() => setError('')} />
      {!resources && !error ? (
        <div role="status" className="ds-loading-state">
          Loading contract catalogue and PostgreSQL status…
        </div>
      ) : null}
      {resources ? (
        <ContractLabPage
          resources={resources}
          onSaved={refreshHealth}
          onHistory={() => router.push('/history')}
          onError={setError}
        />
      ) : null}
    </>
  );
}
