import type { ProfileType } from '@ai-runtime/contracts';
import type { SavedValidation } from '../../../shared/api/lab-client.js';

function EmptyReport() {
  return (
    <div className="empty-result">
      <div className="empty-icon">✓</div>
      <h3>Siap menerima request.</h3>
      <p>
        Klik validasi untuk mengecek schema dan kecocokan profile. Hasil akan
        disimpan di PostgreSQL.
      </p>
      <div className="check-list">
        <span>
          01 <b>Schema & field</b>
        </span>
        <span>
          02 <b>Capability & batas profile</b>
        </span>
        <span>
          03 <b>Persistence & request ID</b>
        </span>
      </div>
    </div>
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
    <section className="panel result-panel">
      <div className="panel-head">
        <h2>Hasil pemeriksaan</h2>
        <span className="step-label">02 / EVALUASI</span>
      </div>
      {!saved ? (
        <EmptyReport />
      ) : (
        <div className="result-content" aria-live="polite">
          <div className={'verdict ' + (saved.valid ? 'valid' : 'invalid')}>
            <span>{saved.valid ? '✓' : '!'}</span>
            <div>
              <strong data-testid="verdict">
                {saved.valid ? 'Kontrak valid' : 'Kontrak ditolak'}
              </strong>
              <small>
                {saved.replayed
                  ? 'Replay · tidak membuat record baru'
                  : 'Record tersimpan di PostgreSQL'}
              </small>
            </div>
          </div>
          <dl className="result-meta">
            <div>
              <dt>Application</dt>
              <dd>{saved.application_id}</dd>
            </div>
            <div>
              <dt>Profile</dt>
              <dd>{saved.report.profile?.profile ?? 'Tidak resolved'}</dd>
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
          {saved.report.issues.map((issue, index) => (
            <div className="issue" key={index}>
              <code>{issue.path || '/'}</code>
              <strong>{issue.code}</strong>
              <p>{issue.message}</p>
            </div>
          ))}
          {saved.report.warnings.map((warning, index) => (
            <p className="notice" key={index}>
              {warning}
            </p>
          ))}
          <button className="secondary full" onClick={onHistory}>
            Lihat riwayat di database →
          </button>
        </div>
      )}
      <div className="profile-note">
        <span className="tiny-label">PROFILE YANG DIPILIH</span>
        <strong>{profile?.title ?? 'Belum ditemukan'}</strong>
        <p>
          {profile?.description ?? 'Pilih profile yang tersedia pada skenario.'}
        </p>
        <div>
          <span>{profile?.execution_path ?? '—'}</span>
          <span>
            {profile?.runtime_adapter ?? profile?.provider_adapter ?? '—'} ·
            planned
          </span>
        </div>
      </div>
    </section>
  );
}
