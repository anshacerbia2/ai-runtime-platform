'use client';
import { useState } from 'react';
import { HistoryPage } from './history-page';
import { PageHeader } from '../../design-system/compositions/page-header';
import { ErrorBanner } from '../../shared/ui/error-banner';
export function HistoryScreen() {
  const [error, setError] = useState('');
  return (
    <>
      <PageHeader
        eyebrow="Audit trail"
        title="Validation History"
        description="Review durable contract-validation metadata stored in PostgreSQL without persisting raw prompts."
      />
      <ErrorBanner message={error} onDismiss={() => setError('')} />
      <HistoryPage onError={setError} onRefresh={async () => {}} />
    </>
  );
}
