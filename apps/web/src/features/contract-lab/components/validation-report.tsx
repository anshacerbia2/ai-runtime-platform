import type { ProfileType } from '@ai-runtime/contracts';
import type { SavedValidation } from '../../../shared/api/lab-client.js';
import { Button } from '../../../design-system/primitives/button.js';
import { Badge } from '../../../design-system/components/badge.js';
import { EmptyState } from '../../../design-system/components/empty-state.js';
import { Panel, PanelHeader } from '../../../design-system/components/panel.js';

function EmptyReport() {
  return (
    <EmptyState
      icon="✓"
      title="Ready for validation"
      description="Run the request to validate schema, capability, profile limits, and durable persistence."
    />
  );
}

export function ValidationReport({
  saved,
  profile,
  onHistory,
}: {
  saved: SavedValidation | null;
  profile?: ProfileType;
  onHistory(): void;
}) {
  return (
    <Panel className="workbench-result">
      <PanelHeader
        title="Validation result"
        description="Normalized contract outcome and resolved platform metadata."
        aside={
          <Badge tone={saved?.valid ? 'success' : saved ? 'danger' : 'neutral'}>
            {saved ? (saved.valid ? 'VALID' : 'REJECTED') : 'WAITING'}
          </Badge>
        }
      />
      {!saved ? (
        <EmptyReport />
      ) : (
        <div className="result-content" aria-live="polite">
          <div
            className={`result-verdict ${saved.valid ? 'is-valid' : 'is-invalid'}`}
          >
            <div className="result-symbol">{saved.valid ? '✓' : '!'}</div>
            <div>
              <strong data-testid="verdict">
                {saved.valid ? 'Kontrak valid' : 'Kontrak ditolak'}
              </strong>
              <span>
                {saved.replayed
                  ? 'Replay · tidak membuat record baru'
                  : 'New durable validation record'}
              </span>
            </div>
          </div>
          <dl className="result-meta">
            <div>
              <dt>Application</dt>
              <dd>{saved.application_id}</dd>
            </div>
            <div>
              <dt>Profile</dt>
              <dd>{saved.report.profile?.profile ?? 'Unresolved'}</dd>
            </div>
            <div>
              <dt>Capability</dt>
              <dd>{saved.report.capability ?? '—'}</dd>
            </div>
            <div>
              <dt>Record ID</dt>
              <dd className="mono">{saved.id}</dd>
            </div>
          </dl>
          {saved.report.issues.length ? (
            <div className="issue-list">
              {saved.report.issues.map((issue, index) => (
                <article className="issue-card" key={index}>
                  <div>
                    <code>{issue.path || '/'}</code>
                    <Badge tone="danger">{issue.code}</Badge>
                  </div>
                  <p>{issue.message}</p>
                </article>
              ))}
            </div>
          ) : null}
          {saved.report.warnings.map((warning, index) => (
            <p className="notice" key={index}>
              {warning}
            </p>
          ))}
          <Button variant="secondary" onClick={onHistory}>
            Open validation history
          </Button>
        </div>
      )}
      <div className="profile-summary">
        <span className="ds-eyebrow">Resolved profile</span>
        <strong>{profile?.title ?? 'No profile resolved'}</strong>
        <p>
          {profile?.description ??
            'Choose a scenario with a published profile.'}
        </p>
        <div>
          <Badge>{profile?.execution_path ?? '—'}</Badge>
          <Badge tone="info">
            {profile?.runtime_adapter ??
              profile?.provider_adapter ??
              'No adapter'}{' '}
            · planned runtime
          </Badge>
        </div>
      </div>
    </Panel>
  );
}
