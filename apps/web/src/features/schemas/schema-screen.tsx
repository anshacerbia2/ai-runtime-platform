'use client';

import { useState } from 'react';
import { useWorkspace } from '../workspace/use-workspace';
import { SchemaExplorer } from './schema-explorer';
import { PageHeader } from '../../design-system/compositions/page-header';
import { ErrorBanner } from '../../shared/ui/error-banner';
import { QueryFeedback } from '../../shared/ui/query-feedback';

export function SchemaScreen() {
  const { resources, catalogue, refreshCatalogue } = useWorkspace();
  const [error, setError] = useState('');

  return (
    <>
      <PageHeader
        eyebrow="Developer catalogue"
        title="Schema Explorer"
        description="Browse the generated JSON Schema catalogue used by frontend and backend validation."
      />
      <ErrorBanner message={error} onDismiss={() => setError('')} />
      <QueryFeedback
        state={catalogue}
        label="catalogue"
        onRetry={refreshCatalogue}
      />
      {resources ? (
        <SchemaExplorer schemas={resources.schemas} onError={setError} />
      ) : null}
    </>
  );
}
