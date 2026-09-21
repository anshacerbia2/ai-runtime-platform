import { useState } from 'react';
import {
  AppShell,
  type AppSection,
} from '../design-system/compositions/app-shell.js';
import { PageHeader } from '../design-system/compositions/page-header.js';
import { StatusOverview } from '../design-system/components/status-overview.js';
import { Badge } from '../design-system/components/badge.js';
import { ErrorBanner } from '../shared/ui/error-banner.js';
import { ContractLabPage } from '../features/contract-lab/contract-lab-page.js';
import { HistoryPage } from '../features/history/history-page.js';
import { SchemaExplorer } from '../features/schemas/schema-explorer.js';
import { PhaseGuide } from '../features/roadmap/phase-guide.js';
import { ControlPlanePage } from '../features/control-plane/control-plane-page.js';
import { useWorkspace } from './use-workspace.js';

const headers: Record<AppSection, [string, string, string]> = {
  playground: [
    'Engineering workbench',
    'Contract Lab',
    'Validate application requests against the canonical contract before any provider or runtime is involved.',
  ],
  'control-plane': [
    'Durable foundation',
    'Control Plane',
    'Inspect the application-scoped M1 registries, policy bindings, budgets, profiles, and runner metadata.',
  ],
  contracts: [
    'Developer catalogue',
    'Schema Explorer',
    'Browse the generated JSON Schema catalogue used by the frontend and backend validation boundary.',
  ],
  history: [
    'Audit trail',
    'Validation History',
    'Review durable contract-validation metadata stored in PostgreSQL without persisting raw prompts.',
  ],
  phases: [
    'Reference',
    'Delivery Plan',
    'Track implemented milestones, planned platform capabilities, and the local verification commands.',
  ],
};

export function App() {
  const [section, setSection] = useState<AppSection>('playground');
  const { resources, error, setError, refreshHealth } = useWorkspace();
  const [eyebrow, title, description] = headers[section];

  function navigate(next: AppSection) {
    setSection(next);
    setError('');
  }

  return (
    <AppShell active={section} onNavigate={navigate}>
      <PageHeader
        eyebrow={eyebrow}
        title={title}
        description={description}
        meta={
          section === 'control-plane' ? (
            <Badge tone="success">M1 local complete</Badge>
          ) : resources?.health.contract_version ? (
            <Badge tone="info">
              Contract {resources.health.contract_version}
            </Badge>
          ) : (
            <Badge tone="neutral">Local console</Badge>
          )
        }
      />
      {section === 'playground' ? (
        <StatusOverview health={resources?.health} />
      ) : null}
      <ErrorBanner message={error} onDismiss={() => setError('')} />
      {!resources && !error && section !== 'control-plane' ? (
        <div className="ds-loading-state" role="status">
          Loading contract catalogue and PostgreSQL status…
        </div>
      ) : null}
      {resources && section === 'playground' ? (
        <ContractLabPage
          resources={resources}
          onSaved={refreshHealth}
          onHistory={() => navigate('history')}
          onError={setError}
        />
      ) : null}
      {section === 'control-plane' ? <ControlPlanePage /> : null}
      {section === 'history' ? (
        <HistoryPage onError={setError} onRefresh={refreshHealth} />
      ) : null}
      {resources && section === 'contracts' ? (
        <SchemaExplorer schemas={resources.schemas} onError={setError} />
      ) : null}
      {section === 'phases' ? <PhaseGuide /> : null}
      <footer className="ds-page-footer">
        <span>AI Runtime Platform</span>
        <span>
          M0 + M1 local implementation complete · production evidence remains
          gated.
        </span>
      </footer>
    </AppShell>
  );
}
