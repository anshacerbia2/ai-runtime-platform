import { useEffect, useState } from 'react';
import { labClient, type SavedValidation } from '../../shared/api/lab-client';
import { errorMessage } from '../../shared/api/http-client';
import { prettyJson } from '../../shared/lib/json';
import { Button } from '../../design-system/primitives/button';
import { Badge } from '../../design-system/components/badge';
import { DataTable } from '../../design-system/components/data-table';
import { EmptyState } from '../../design-system/components/empty-state';
import { Panel, PanelHeader } from '../../design-system/components/panel';

export function HistoryPage({
  onError,
  onRefresh,
}: {
  onError(error: string): void;
  onRefresh(): Promise<void>;
}) {
  const [items, setItems] = useState<SavedValidation[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState<SavedValidation | null>(null);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    let active = true;
    void labClient
      .history()
      .then((page) => {
        if (active) {
          setItems(page.items);
          setCursor(page.next_cursor);
        }
      })
      .catch((error: unknown) => {
        if (active) {
          onError(errorMessage(error));
        }
      })
      .finally(() => {
        if (active) {
          setBusy(false);
        }
      });
    return () => {
      active = false;
    };
  }, [onError]);

  async function load(more = false) {
    setBusy(true);
    try {
      const page = await labClient.history(more ? cursor : null);
      setItems((previous) =>
        more ? [...previous, ...page.items] : page.items,
      );
      setCursor(page.next_cursor);
      await onRefresh();
    } catch (error) {
      onError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="audit-layout">
      <Panel>
        <PanelHeader
          title="Validation records"
          description="Application-scoped contract metadata persisted in PostgreSQL."
          aside={
            <Button size="sm" disabled={busy} onClick={() => void load()}>
              Refresh
            </Button>
          }
        />
        {items.length ? (
          <DataTable label="Validation records">
            <thead>
              <tr>
                <th>Time</th>
                <th>Contract</th>
                <th>Result</th>
                <th>Record</th>
                <th>
                  <span className="sr-only">Action</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr key={row.id}>
                  <td>{new Date(row.created_at).toLocaleString('id-ID')}</td>
                  <td>
                    <code>{row.kind}</code>
                  </td>
                  <td>
                    <Badge tone={row.valid ? 'success' : 'danger'}>
                      {row.valid ? 'VALID' : 'INVALID'}
                    </Badge>
                  </td>
                  <td className="mono">{row.id.slice(0, 13)}…</td>
                  <td>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setSelected(row)}
                    >
                      Inspect
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        ) : busy ? (
          <div className="ds-loading-state" role="status">
            Loading validation records…
          </div>
        ) : (
          <EmptyState
            title="No validation records yet"
            description="Create a validation from Contract Lab to populate this durable audit view."
          />
        )}
        {cursor ? (
          <div className="panel-actions">
            <Button disabled={busy} onClick={() => void load(true)}>
              Load more
            </Button>
          </div>
        ) : null}
      </Panel>
      <Panel className="audit-inspector">
        <PanelHeader
          title="Record inspector"
          description="Raw durable metadata for the selected validation."
        />
        {selected ? (
          <pre className="code-surface">{prettyJson(selected)}</pre>
        ) : (
          <EmptyState
            title="Select a record"
            description="Choose Inspect from the table to view the complete stored metadata."
          />
        )}
        <div className="privacy-note">
          Raw prompts, provider credentials, and business-job data are not
          persisted by Contract Lab.
        </div>
      </Panel>
    </div>
  );
}
