import { useState } from 'react';
import {
  WorkspaceShell,
  type WorkspaceTab,
} from '../shared/ui/workspace-shell.js';
import { PageHeading } from '../shared/ui/page-heading.js';
import { StatusOverview } from '../shared/ui/status-overview.js';
import { ErrorBanner } from '../shared/ui/error-banner.js';
import { ContractLabPage } from '../features/contract-lab/contract-lab-page.js';
import { HistoryPage } from '../features/history/history-page.js';
import { SchemaExplorer } from '../features/schemas/schema-explorer.js';
import { PhaseGuide } from '../features/roadmap/phase-guide.js';
import { useWorkspace } from './use-workspace.js';

export function App() {
  const [tab, setTab] = useState<WorkspaceTab>('playground');
  const { resources, error, setError, refreshHealth } = useWorkspace();
  function navigate(next: WorkspaceTab) {
    setTab(next);
    setError('');
  }

  return (
    <WorkspaceShell tab={tab} onNavigate={navigate}>
      <PageHeading tab={tab} version={resources?.health.contract_version} />
      <StatusOverview health={resources?.health} />
      <ErrorBanner message={error} onDismiss={() => setError('')} />
      {!resources && !error && (
        <p role="status">Memuat kontrak dan koneksi database…</p>
      )}
      {resources && tab === 'playground' && (
        <ContractLabPage
          resources={resources}
          onSaved={refreshHealth}
          onHistory={() => navigate('history')}
          onError={setError}
        />
      )}
      {tab === 'history' && (
        <HistoryPage onError={setError} onRefresh={refreshHealth} />
      )}
      {resources && tab === 'contracts' && (
        <SchemaExplorer schemas={resources.schemas} onError={setError} />
      )}
      {tab === 'phases' && <PhaseGuide />}
    </WorkspaceShell>
  );
}
