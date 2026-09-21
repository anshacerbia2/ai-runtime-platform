import { useEffect, useMemo, useState } from 'react';
import {
  errorMessage,
  requestPlatformJson,
} from '../../shared/api/http-client.js';
import { Badge, type BadgeTone } from '../../design-system/components/badge.js';
import { DataTable } from '../../design-system/components/data-table.js';
import { EmptyState } from '../../design-system/components/empty-state.js';
import { MetricCard } from '../../design-system/components/metric-card.js';
import { Panel, PanelHeader } from '../../design-system/components/panel.js';

interface ApplicationRecord {
  id: string;
  displayName: string;
  environment: string;
  keycloakClientId: string;
  status: string;
  revision: number;
}
interface ConnectionRecord {
  id: string;
  displayName: string;
  provider: string;
  authMode: string;
  environment: string;
  sharingMode: string;
  quotaGroupRef: string | null;
  status: string;
  revision: number;
}
interface CredentialRecord {
  id: string;
  connectionId: string;
  residency: string;
  runnerRef: string | null;
  status: string;
  revision: number;
}
interface BindingRecord {
  id: string;
  applicationId: string;
  connectionId: string;
  profileRef: string | null;
  status: string;
  revision: number;
}
interface ProfileRecord {
  id: string;
  applicationId: string;
  profileRef: string;
  revision: number;
  connectionId: string;
  capability: string;
  holdUnits: string;
  accountIds: string[];
  digest: string;
  createdAt?: string;
}
interface AliasRecord {
  applicationId: string;
  profileRef: string;
  revision: number;
  enabled: boolean;
  version?: number;
}
interface BudgetRecord {
  id: string;
  applicationId: string | null;
  quotaGroupRef: string | null;
  unit: string;
  period: string;
  limitUnits: string;
  heldUnits: string;
  postedUnits: string;
  revision: number;
}
interface PoolRecord {
  id: string;
  environment: string;
  region: string;
  minimumVersion: string;
  status: string;
  revision: number;
}
interface RunnerRecord {
  id: string;
  ownerSubject: string;
  poolId: string;
  version: string;
  capabilities: string[];
  connectionIds: string[];
  capacity: number;
  status: string;
  revision: number;
  lastHeartbeatAt: string;
}
interface Snapshot {
  applications: ApplicationRecord[];
  connections: ConnectionRecord[];
  credentials: CredentialRecord[];
  bindings: BindingRecord[];
  aliases: AliasRecord[];
  profiles: ProfileRecord[];
  budgets: BudgetRecord[];
  pools: PoolRecord[];
  runners: RunnerRecord[];
}

type View =
  | 'overview'
  | 'applications'
  | 'connections'
  | 'profiles'
  | 'budgets'
  | 'runners';

const views: Array<{ id: View; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'applications', label: 'Applications' },
  { id: 'connections', label: 'Connections' },
  { id: 'profiles', label: 'Profiles' },
  { id: 'budgets', label: 'Budgets' },
  { id: 'runners', label: 'Runner fleet' },
];

function statusTone(status: string): BadgeTone {
  if (['ENABLED', 'RUNNING'].includes(status)) {
    return 'success';
  }
  if (['DRAINING', 'DISABLED'].includes(status)) {
    return 'warning';
  }
  return 'neutral';
}

function ResourceTabs({
  active,
  onChange,
}: {
  active: View;
  onChange(view: View): void;
}) {
  return (
    <div
      className="resource-tabs"
      role="tablist"
      aria-label="Control plane resources"
    >
      {views.map((view) => (
        <button
          key={view.id}
          role="tab"
          aria-selected={active === view.id}
          className={
            active === view.id ? 'resource-tab is-active' : 'resource-tab'
          }
          onClick={() => onChange(view.id)}
        >
          {view.label}
        </button>
      ))}
    </div>
  );
}

function Overview({ snapshot }: { snapshot: Snapshot }) {
  const enabledApplications = snapshot.applications.filter(
    (item) => item.status === 'ENABLED',
  ).length;
  const exposure = snapshot.budgets.reduce(
    (total, item) => total + BigInt(item.heldUnits) + BigInt(item.postedUnits),
    0n,
  );
  return (
    <div className="control-overview">
      <section className="ds-metric-grid" aria-label="Control plane summary">
        <MetricCard
          label="Applications"
          value={snapshot.applications.length}
          detail={`${enabledApplications} enabled`}
          status={<Badge tone="success">Application scoped</Badge>}
        />
        <MetricCard
          label="AI connections"
          value={snapshot.connections.length}
          detail={`${snapshot.credentials.length} credential metadata records`}
          status={<Badge tone="info">No secrets returned</Badge>}
        />
        <MetricCard
          label="Profiles"
          value={snapshot.profiles.length}
          detail={`${snapshot.aliases.length} active aliases`}
          status={<Badge tone="neutral">Revisioned</Badge>}
        />
        <MetricCard
          label="Budget exposure"
          value={exposure.toString()}
          detail={`${snapshot.budgets.length} durable accounts`}
          status={<Badge tone="warning">Local units</Badge>}
        />
      </section>
      <div className="control-summary-grid">
        <Panel>
          <PanelHeader
            title="Identity & application boundary"
            description="Keycloak/OIDC verification is implemented. This local console uses separate local operator authority."
            aside={<Badge tone="success">M1 implemented</Badge>}
          />
          <dl className="fact-list">
            <div>
              <dt>Applications</dt>
              <dd>{snapshot.applications.length}</dd>
            </div>
            <div>
              <dt>Credential bindings</dt>
              <dd>{snapshot.bindings.length}</dd>
            </div>
            <div>
              <dt>OIDC mapping</dt>
              <dd>Application Registry</dd>
            </div>
            <div>
              <dt>Live ATI Keycloak</dt>
              <dd>
                <Badge tone="warning">External evidence pending</Badge>
              </dd>
            </div>
          </dl>
        </Panel>
        <Panel>
          <PanelHeader
            title="Runner foundation"
            description="Durable pool/node metadata exists; P3 placement and Redis hot liveness are intentionally not active."
            aside={<Badge tone="info">Foundation only</Badge>}
          />
          <dl className="fact-list">
            <div>
              <dt>Runner pools</dt>
              <dd>{snapshot.pools.length}</dd>
            </div>
            <div>
              <dt>Registered nodes</dt>
              <dd>{snapshot.runners.length}</dd>
            </div>
            <div>
              <dt>Placement engine</dt>
              <dd>Planned P3</dd>
            </div>
            <div>
              <dt>Redis heartbeat</dt>
              <dd>External deployment pending</dd>
            </div>
          </dl>
        </Panel>
      </div>
      <Panel>
        <PanelHeader
          title="Capability boundary"
          description="M1 owns durable control and accounting. Provider execution and agent placement remain outside this milestone."
        />
        <div className="capability-strip">
          <Badge tone="success">Registry & policy</Badge>
          <Badge tone="success">Admission & idempotency</Badge>
          <Badge tone="success">Budget & ledger</Badge>
          <Badge tone="success">Audit & artifacts metadata</Badge>
          <Badge tone="warning">Provider gateway · M2</Badge>
          <Badge tone="warning">Agent placement · M3</Badge>
        </div>
      </Panel>
    </div>
  );
}

function Applications({ snapshot }: { snapshot: Snapshot }) {
  return (
    <Panel>
      <PanelHeader
        title="Applications"
        description="First-class security and ownership boundary for the current single-organization deployment."
        aside={<Badge>{snapshot.applications.length} records</Badge>}
      />
      <DataTable label="Application registry">
        <thead>
          <tr>
            <th>Application</th>
            <th>Environment</th>
            <th>OIDC client</th>
            <th>Revision</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {snapshot.applications.map((item) => (
            <tr key={item.id}>
              <td>
                <strong>{item.displayName}</strong>
                <code>{item.id}</code>
              </td>
              <td>{item.environment}</td>
              <td>
                <code>{item.keycloakClientId}</code>
              </td>
              <td>{item.revision}</td>
              <td>
                <Badge tone={statusTone(item.status)}>{item.status}</Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </DataTable>
    </Panel>
  );
}

function Connections({ snapshot }: { snapshot: Snapshot }) {
  return (
    <div className="resource-stack">
      <Panel>
        <PanelHeader
          title="AI connections"
          description="Logical upstream accounts/projects. Browser views never receive secret references."
          aside={<Badge>{snapshot.connections.length} connections</Badge>}
        />
        {snapshot.connections.length ? (
          <DataTable label="AI connections">
            <thead>
              <tr>
                <th>Connection</th>
                <th>Provider</th>
                <th>Auth</th>
                <th>Sharing</th>
                <th>Quota group</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.connections.map((item) => (
                <tr key={item.id}>
                  <td>
                    <strong>{item.displayName}</strong>
                    <code>{item.id}</code>
                  </td>
                  <td>{item.provider}</td>
                  <td>{item.authMode}</td>
                  <td>{item.sharingMode}</td>
                  <td>{item.quotaGroupRef ?? '—'}</td>
                  <td>
                    <Badge tone={statusTone(item.status)}>{item.status}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        ) : (
          <EmptyState
            title="No AI connections configured"
            description="The registry is ready, but local seed deliberately does not fabricate provider accounts."
          />
        )}
      </Panel>
      <div className="control-summary-grid">
        <Panel>
          <PanelHeader
            title="Credential metadata"
            description="Residency and lifecycle metadata only. No credential values or secret references are returned."
          />
          {snapshot.credentials.length ? (
            <DataTable label="Credential metadata">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Connection</th>
                  <th>Residency</th>
                  <th>Runner</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.credentials.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <code>{item.id}</code>
                    </td>
                    <td>{item.connectionId}</td>
                    <td>{item.residency}</td>
                    <td>{item.runnerRef ?? 'Central'}</td>
                    <td>
                      <Badge tone={statusTone(item.status)}>
                        {item.status}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          ) : (
            <EmptyState
              title="No credential metadata"
              description="Credential records appear only after an operator configures a real connection."
            />
          )}
        </Panel>
        <Panel>
          <PanelHeader
            title="Credential bindings"
            description="Explicit application/profile authorization to use a logical AI connection."
          />
          {snapshot.bindings.length ? (
            <DataTable label="Credential bindings">
              <thead>
                <tr>
                  <th>Application</th>
                  <th>Connection</th>
                  <th>Profile</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.bindings.map((item) => (
                  <tr key={item.id}>
                    <td>{item.applicationId}</td>
                    <td>{item.connectionId}</td>
                    <td>{item.profileRef ?? 'All allowed profiles'}</td>
                    <td>
                      <Badge tone={statusTone(item.status)}>
                        {item.status}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          ) : (
            <EmptyState
              title="No bindings configured"
              description="Bindings are created only when a real application-to-connection policy exists."
            />
          )}
        </Panel>
      </div>
    </div>
  );
}

function Profiles({ snapshot }: { snapshot: Snapshot }) {
  return (
    <Panel>
      <PanelHeader
        title="Execution profiles"
        description="Immutable revisions with explicit aliases determine durable admission policy."
        aside={<Badge>{snapshot.profiles.length} revisions</Badge>}
      />
      {snapshot.profiles.length ? (
        <DataTable label="Execution profiles">
          <thead>
            <tr>
              <th>Profile</th>
              <th>Application</th>
              <th>Capability</th>
              <th>Connection</th>
              <th>Hold</th>
              <th>Revision</th>
            </tr>
          </thead>
          <tbody>
            {snapshot.profiles.map((item) => (
              <tr key={item.id}>
                <td>
                  <strong>{item.profileRef}</strong>
                  <code>{item.digest.slice(0, 12)}…</code>
                </td>
                <td>{item.applicationId}</td>
                <td>{item.capability}</td>
                <td>{item.connectionId}</td>
                <td>{item.holdUnits}</td>
                <td>{item.revision}</td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      ) : (
        <EmptyState
          title="No M1 profiles published"
          description="M0 demo profiles are separate from the production-oriented M1 revision registry."
        />
      )}
    </Panel>
  );
}

function Budgets({ snapshot }: { snapshot: Snapshot }) {
  return (
    <Panel>
      <PanelHeader
        title="Budget accounts"
        description="Durable held and posted exposure. Unknown usage is never represented as zero."
        aside={<Badge>{snapshot.budgets.length} accounts</Badge>}
      />
      {snapshot.budgets.length ? (
        <DataTable label="Budget accounts">
          <thead>
            <tr>
              <th>Account</th>
              <th>Scope</th>
              <th>Period</th>
              <th>Limit</th>
              <th>Held</th>
              <th>Posted</th>
            </tr>
          </thead>
          <tbody>
            {snapshot.budgets.map((item) => (
              <tr key={item.id}>
                <td>
                  <code>{item.id}</code>
                </td>
                <td>{item.applicationId ?? `Quota · ${item.quotaGroupRef}`}</td>
                <td>{item.period}</td>
                <td>
                  {item.limitUnits} {item.unit}
                </td>
                <td>{item.heldUnits}</td>
                <td>{item.postedUnits}</td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      ) : (
        <EmptyState
          title="No budget accounts configured"
          description="Budget accounts are created by operators when an M1 execution profile is published."
        />
      )}
    </Panel>
  );
}

function Runners({ snapshot }: { snapshot: Snapshot }) {
  return (
    <div className="resource-stack">
      <Panel>
        <PanelHeader
          title="Runner pools"
          description="Durable placement policy metadata. Redis liveness and P3 scheduling are not active here."
          aside={<Badge>{snapshot.pools.length} pools</Badge>}
        />
        {snapshot.pools.length ? (
          <DataTable label="Runner pools">
            <thead>
              <tr>
                <th>Pool</th>
                <th>Environment</th>
                <th>Region</th>
                <th>Minimum version</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.pools.map((item) => (
                <tr key={item.id}>
                  <td>
                    <code>{item.id}</code>
                  </td>
                  <td>{item.environment}</td>
                  <td>{item.region}</td>
                  <td>{item.minimumVersion}</td>
                  <td>
                    <Badge tone={statusTone(item.status)}>{item.status}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        ) : (
          <EmptyState
            title="No runner pools"
            description="Runner pools are created only for workloads that will use the distributed runtime."
          />
        )}
      </Panel>
      <Panel>
        <PanelHeader
          title="Registered runner nodes"
          description="Authenticated durable registration metadata; heartbeat freshness is not presented as live unless deployed."
          aside={<Badge>{snapshot.runners.length} nodes</Badge>}
        />
        {snapshot.runners.length ? (
          <DataTable label="Runner nodes">
            <thead>
              <tr>
                <th>Runner</th>
                <th>Pool</th>
                <th>Version</th>
                <th>Capabilities</th>
                <th>Capacity</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.runners.map((item) => (
                <tr key={item.id}>
                  <td>
                    <code>{item.id}</code>
                  </td>
                  <td>{item.poolId}</td>
                  <td>{item.version}</td>
                  <td>{item.capabilities.join(', ')}</td>
                  <td>{item.capacity}</td>
                  <td>
                    <Badge tone={statusTone(item.status)}>{item.status}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        ) : (
          <EmptyState
            title="No runner nodes registered"
            description="No distributed runner has registered in this local workspace."
          />
        )}
      </Panel>
    </div>
  );
}

export function ControlPlanePage() {
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [error, setError] = useState('');
  const [view, setView] = useState<View>('overview');

  useEffect(() => {
    requestPlatformJson<Snapshot>('/api/m1/control-plane')
      .then(setSnapshot)
      .catch((cause: unknown) => setError(errorMessage(cause)));
  }, []);

  const content = useMemo(() => {
    if (!snapshot) {
      return null;
    }
    if (view === 'applications') {
      return <Applications snapshot={snapshot} />;
    }
    if (view === 'connections') {
      return <Connections snapshot={snapshot} />;
    }
    if (view === 'profiles') {
      return <Profiles snapshot={snapshot} />;
    }
    if (view === 'budgets') {
      return <Budgets snapshot={snapshot} />;
    }
    if (view === 'runners') {
      return <Runners snapshot={snapshot} />;
    }
    return <Overview snapshot={snapshot} />;
  }, [snapshot, view]);

  if (error) {
    return (
      <div className="error-banner" role="alert">
        {error}
      </div>
    );
  }
  if (!snapshot) {
    return (
      <div className="ds-loading-state" role="status">
        Loading durable control-plane snapshot…
      </div>
    );
  }

  return (
    <div className="control-plane">
      <Panel className="control-plane-hero">
        <div>
          <span className="ds-eyebrow">Control Plane Registry</span>
          <h2>Application-scoped durable authority</h2>
          <p>
            Inspect the implemented M1 control foundation. Local evidence is
            complete; live ATI Keycloak, Redis hot liveness, secret-manager
            deployment, provider execution, and agent placement remain gated.
          </p>
        </div>
        <div className="hero-badges">
          <Badge tone="success">M1 local complete</Badge>
          <Badge tone="info">PostgreSQL authority</Badge>
        </div>
      </Panel>
      <ResourceTabs active={view} onChange={setView} />
      <div role="tabpanel">{content}</div>
    </div>
  );
}
