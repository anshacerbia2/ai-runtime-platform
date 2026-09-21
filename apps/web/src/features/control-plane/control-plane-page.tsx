import { useEffect, useState } from 'react';
import {
  errorMessage,
  requestPlatformJson,
} from '../../shared/api/http-client.js';
import { Badge } from '../../shared/ui/badge.js';
import { Panel } from '../../shared/ui/panel.js';

interface Application {
  id: string;
  displayName: string;
  environment: string;
  keycloakClientId: string;
  status: string;
}
interface Connection {
  id: string;
  displayName: string;
  provider: string;
  authMode: string;
  environment: string;
  sharingMode: string;
  quotaGroupRef: string | null;
  status: string;
  credentialInstances: number;
}
interface Binding {
  id: string;
  applicationId: string;
  connectionId: string;
  profileRef: string | null;
  status: string;
}
interface Snapshot {
  applications: Application[];
  connections: Connection[];
  bindings: Binding[];
}

export function ControlPlanePage() {
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [error, setError] = useState('');
  useEffect(() => {
    requestPlatformJson<Snapshot>('/api/m1/control-plane')
      .then(setSnapshot)
      .catch((cause: unknown) => setError(errorMessage(cause)));
  }, []);
  if (error) {
    return (
      <div className="error-banner" role="alert">
        {error}
      </div>
    );
  }
  if (!snapshot) {
    return (
      <div className="loading-state" role="status">
        Memuat control plane…
      </div>
    );
  }

  return (
    <div className="control-plane">
      <Panel className="control-plane-intro">
        <div>
          <span className="tiny-label">DURABLE REGISTRY FOUNDATION</span>
          <h2>Control Plane Registry</h2>
          <p>
            Application registry, AI connections, dan credential bindings berada
            di PostgreSQL. Keycloak verification, secret manager, provider
            calls, dan runner placement belum diaktifkan.
          </p>
        </div>
        <Badge tone="warning">M1 IN PROGRESS</Badge>
      </Panel>
      <div className="registry-grid">
        <Panel className="registry-card">
          <span className="tiny-label">APPLICATIONS</span>
          <strong>{snapshot.applications.length}</strong>
          <small>durable identities</small>
        </Panel>
        <Panel className="registry-card">
          <span className="tiny-label">AI CONNECTIONS</span>
          <strong>{snapshot.connections.length}</strong>
          <small>logical upstream accounts</small>
        </Panel>
        <Panel className="registry-card">
          <span className="tiny-label">BINDINGS</span>
          <strong>{snapshot.bindings.length}</strong>
          <small>application/profile policy</small>
        </Panel>
      </div>{' '}
      <Panel className="registry-section">
        <div className="registry-section-head">
          <h2>Applications</h2>
          <Badge>{snapshot.applications.length} records</Badge>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Name</th>
                <th>Environment</th>
                <th>Keycloak client</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.applications.map((item) => (
                <tr key={item.id}>
                  <td className="mono">{item.id}</td>
                  <td>{item.displayName}</td>
                  <td>{item.environment}</td>
                  <td className="mono">{item.keycloakClientId}</td>
                  <td>
                    <Badge
                      tone={item.status === 'ENABLED' ? 'success' : 'warning'}
                    >
                      {item.status}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <Panel className="registry-section">
        <div className="registry-section-head">
          <h2>AI Connections</h2>
          <Badge>{snapshot.connections.length} records</Badge>
        </div>
        {snapshot.connections.length === 0 ? (
          <p className="empty-state">
            Belum ada AI Connection. Registry siap, tetapi kita tidak membuat
            connection palsu.
          </p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Provider</th>
                  <th>Sharing</th>
                  <th>Credentials</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.connections.map((item) => (
                  <tr key={item.id}>
                    <td>{item.displayName}</td>
                    <td>{item.provider}</td>
                    <td>{item.sharingMode}</td>
                    <td>{item.credentialInstances}</td>
                    <td>
                      <Badge>{item.status}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <Panel className="registry-section">
        <div className="registry-section-head">
          <h2>Credential Bindings</h2>
          <Badge>{snapshot.bindings.length} records</Badge>
        </div>
        {snapshot.bindings.length === 0 ? (
          <p className="empty-state">
            Belum ada binding. Binding baru dibuat setelah authority dan
            connection nyata tersedia.
          </p>
        ) : (
          <div className="table-wrap">
            <table>
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
                      <Badge>{item.status}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
