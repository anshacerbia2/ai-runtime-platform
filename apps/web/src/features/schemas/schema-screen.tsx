'use client';
import { useWorkspace } from '../workspace/use-workspace';
import { SchemaExplorer } from './schema-explorer';
import { PageHeader } from '../../design-system/compositions/page-header';
import { ErrorBanner } from '../../shared/ui/error-banner';
export function SchemaScreen() {
  const { resources, error, setError } = useWorkspace();
  return (
    <>
      <PageHeader
        eyebrow="Developer catalogue"
        title="Schema Explorer"
        description="Browse the generated JSON Schema catalogue used by frontend and backend validation."
      />
      <ErrorBanner message={error} onDismiss={() => setError('')} />
      {resources ? (
        <SchemaExplorer schemas={resources.schemas} onError={setError} />
      ) : (
        <p role="status">Loading catalogue…</p>
      )}
    </>
  );
}
