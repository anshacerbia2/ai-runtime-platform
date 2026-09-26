'use client';
import { useCallback, useState } from 'react';
import type { ResourceName } from '@ai-runtime/contracts/http';
import { controlPlaneClient } from '../../shared/api/control-plane-client';
import { useResourceQuery } from '../../shared/api/use-resource-query';
import { latestSnapshot } from '../../shared/api/query-state';
import { errorMessage } from '../../shared/api/http-error';
import { Badge } from '../../design-system/components/badge';
import { DataTable } from '../../design-system/components/data-table';
import { EmptyState } from '../../design-system/components/empty-state';
import { MetricCard } from '../../design-system/components/metric-card';
import { Panel, PanelHeader } from '../../design-system/components/panel';
import { Button } from '../../design-system/primitives/button';

type View =
  | 'overview'
  | 'applications'
  | 'connections'
  | 'profiles'
  | 'budgets'
  | 'runners'
  | 'audit'
  | 'outbox';
const views: readonly [View, string][] = [
  ['overview', 'Overview'],
  ['applications', 'Applications'],
  ['connections', 'Connections'],
  ['profiles', 'Profiles'],
  ['budgets', 'Budgets'],
  ['runners', 'Runner fleet'],
  ['audit', 'Audit'],
  ['outbox', 'Outbox'],
];
const collections: Record<Exclude<View, 'overview'>, ResourceName[]> = {
  applications: ['applications'],
  connections: ['connections', 'credentials', 'bindings'],
  profiles: ['profiles', 'aliases'],
  budgets: ['budgets'],
  runners: ['pools', 'runners'],
  audit: ['audit'],
  outbox: ['outbox'],
};
const labels: Record<ResourceName, string> = {
  applications: 'Applications',
  connections: 'AI connections',
  credentials: 'Credential metadata',
  bindings: 'Credential bindings',
  profiles: 'Execution profiles',
  aliases: 'Profile aliases',
  budgets: 'Budget accounts',
  pools: 'Runner pools',
  runners: 'Runner nodes',
  audit: 'Audit entries',
  outbox: 'Outbox metadata',
};
const empty: Record<ResourceName, string> = {
  applications: 'No applications configured',
  connections: 'No AI connections configured',
  credentials: 'No credential metadata',
  bindings: 'No bindings configured',
  profiles: 'No M1 profiles published',
  aliases: 'No profile aliases',
  budgets: 'No budget accounts configured',
  pools: 'No runner pools',
  runners: 'No runner nodes registered',
  audit: 'No audit entries',
  outbox: 'No outbox events',
};
const columns: Record<ResourceName, string[]> = {
  applications: [
    'id',
    'displayName',
    'environment',
    'keycloakClientId',
    'revision',
    'status',
  ],
  connections: [
    'id',
    'displayName',
    'provider',
    'authMode',
    'sharingMode',
    'quotaGroupRef',
    'status',
  ],
  credentials: [
    'id',
    'connectionId',
    'residency',
    'runnerRef',
    'revision',
    'status',
  ],
  bindings: [
    'id',
    'applicationId',
    'connectionId',
    'profileRef',
    'revision',
    'status',
  ],
  profiles: [
    'id',
    'applicationId',
    'profileRef',
    'capability',
    'connectionId',
    'holdUnits',
    'revision',
  ],
  aliases: ['applicationId', 'profileRef', 'revision', 'enabled', 'version'],
  budgets: [
    'id',
    'applicationId',
    'quotaGroupRef',
    'period',
    'unit',
    'limitUnits',
    'heldUnits',
    'postedUnits',
  ],
  pools: [
    'id',
    'environment',
    'region',
    'minimumVersion',
    'revision',
    'status',
  ],
  runners: [
    'id',
    'poolId',
    'version',
    'capabilities',
    'capacity',
    'revision',
    'status',
  ],
  audit: [
    'id',
    'applicationId',
    'actor',
    'action',
    'resourceId',
    'revision',
    'createdAt',
  ],
  outbox: [
    'id',
    'applicationId',
    'topic',
    'aggregateId',
    'revision',
    'createdAt',
    'deliveredAt',
  ],
};
function text(value: unknown): string {
  if (value === null || value === undefined) {
    return '—';
  }
  if (Array.isArray(value)) {
    return value.map(String).join(', ');
  }
  return String(value);
}

function ResourceCollection({ resource }: { resource: ResourceName }) {
  const [trail, setTrail] = useState<(string | undefined)[]>([undefined]);
  const cursor = trail.at(-1);
  const load = useCallback(
    (signal?: AbortSignal) =>
      controlPlaneClient.list(
        resource,
        { limit: '20', ...(cursor ? { cursor } : {}) },
        signal,
      ),
    [resource, cursor],
  );
  const query = useResourceQuery(load);
  const snapshot = latestSnapshot(query.state);
  const result = snapshot?.data;
  const loading =
    query.state.status === 'loading' || query.state.status === 'idle';
  return (
    <Panel>
      <PanelHeader
        title={labels[resource]}
        description="Independent, bounded resource page. Cursor traversal is live, not a point-in-time snapshot."
        aside={
          <Badge>
            {result ? result.items.length : '…'} records on this page
          </Badge>
        }
      />
      {query.state.status === 'error' ? (
        <div role="alert">
          <p>{errorMessage(query.state.error)}</p>
          <Button onClick={() => void query.refresh()}>Retry {resource}</Button>
        </div>
      ) : null}
      {loading ? <p role="status">Loading {labels[resource]}…</p> : null}
      {result && result.items.length ? (
        <DataTable label={labels[resource]}>
          <thead>
            <tr>
              {columns[resource].map((key) => (
                <th key={key}>{key}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.items.map((item, index) => {
              const row = item as Record<string, unknown>;
              return (
                <tr key={String(row.id ?? index)}>
                  {columns[resource].map((key) => (
                    <td key={key}>{text(row[key])}</td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </DataTable>
      ) : !loading && result ? (
        <EmptyState
          title={empty[resource]}
          description="No matching records on this page. Resources are never fabricated for this console."
        />
      ) : null}
      <div className="editor-toolbar">
        <Button
          disabled={loading || trail.length === 1}
          onClick={() => setTrail((current) => current.slice(0, -1))}
        >
          Previous {resource}
        </Button>
        <span>
          Page {trail.length}
          {query.state.status === 'error' && snapshot
            ? ' · last known data'
            : ''}
        </span>
        <Button
          disabled={
            loading || query.state.status === 'error' || !result?.nextCursor
          }
          onClick={() => {
            if (result?.nextCursor) {
              setTrail((current) => [...current, result.nextCursor!]);
            }
          }}
        >
          Next {resource}
        </Button>
        <Button disabled={loading} onClick={() => void query.refresh()}>
          Refresh {resource}
        </Button>
      </div>
    </Panel>
  );
}
function Overview() {
  const query = useResourceQuery(controlPlaneClient.overview);
  const result = latestSnapshot(query.state)?.data;
  if (query.state.status === 'error') {
    return (
      <div role="alert">
        <p>{errorMessage(query.state.error)}</p>
        <Button onClick={() => void query.refresh()}>Retry overview</Button>
      </div>
    );
  }
  if (!result) {
    return <p role="status">Loading bounded overview…</p>;
  }
  return (
    <div className="control-overview">
      <section className="ds-metric-grid" aria-label="Control plane summary">
        <MetricCard
          label="Applications"
          value={result.counts.applications}
          detail="Registry count"
        />
        <MetricCard
          label="AI connections"
          value={result.counts.connections}
          detail="Logical connection count"
        />
        <MetricCard
          label="Profiles"
          value={result.counts.profiles}
          detail="Immutable revisions"
        />
        <MetricCard
          label="Budget accounts"
          value={result.counts.budgets}
          detail="Balances are not summed across incompatible units"
        />
      </section>
      <Panel>
        <PanelHeader
          title="Independent resource observations"
          description="This overview contains counts only. Open a resource tab for its own paginated data."
        />
        <p>
          Observed at {new Date(result.observedAt).toLocaleTimeString()}. Counts
          are independent observations, not an atomic cross-resource snapshot.
        </p>
        <p>
          {result.counts.runners} registered runners · {result.counts.pools}{' '}
          pools. Durable fencing is implemented; provider execution and
          autonomous dispatch remain gated.
        </p>
      </Panel>
    </div>
  );
}
export function ControlPlanePage() {
  const [view, setView] = useState<View>('overview');
  return (
    <div className="control-plane">
      <Panel className="control-plane-hero">
        <div>
          <h2>Application-scoped durable authority</h2>
          <p>
            Resource contracts, replay receipts, and runner authority are
            verified locally. Live identity, Redis leases, and provider
            execution remain separate deployment gates.
          </p>
        </div>
        <Badge tone="info">PostgreSQL authority</Badge>
      </Panel>
      <div
        className="resource-tabs"
        role="tablist"
        aria-label="Control plane resources"
      >
        {views.map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={view === id}
            className={view === id ? 'resource-tab is-active' : 'resource-tab'}
            onClick={() => setView(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <div role="tabpanel">
        {view === 'overview' ? (
          <Overview />
        ) : (
          <div className="resource-stack">
            {collections[view].map((resource) => (
              <ResourceCollection key={resource} resource={resource} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
