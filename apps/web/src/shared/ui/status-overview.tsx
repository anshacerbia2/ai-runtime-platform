import type { LabHealth } from '../api/lab-client.js';

export function StatusOverview({ health }: { health?: LabHealth }) {
  return (
    <div className="status-grid">
      <div className="status-card">
        <span className="tiny-label">BACKEND</span>
        <strong>
          <i className={health ? 'status-dot' : 'status-dot off'} />
          {health ? 'Terhubung' : 'Belum terhubung'}
        </strong>
        <small>NestJS · Fastify · TypeScript</small>
      </div>
      <div className="status-card">
        <span className="tiny-label">DATABASE</span>
        <strong>
          <i className={health ? 'status-dot' : 'status-dot off'} />
          {health?.database ?? 'Memeriksa koneksi'}
        </strong>
        <small>Prisma · namespace m0</small>
      </div>
      <div className="status-card">
        <span className="tiny-label">VALIDASI TERSIMPAN</span>
        <strong>
          <span data-testid="saved-count">{health?.saved_checks ?? '—'}</span>{' '}
          <small className="inline">records</small>
        </strong>
        <small>Scope: {health?.application_id ?? 'm0-playground'}</small>
      </div>
      <div className="status-card">
        <span className="tiny-label">PROVIDER CALLS</span>
        <strong>
          0<small className="inline">calls</small>
        </strong>
        <small>Eksekusi belum diaktifkan</small>
      </div>
    </div>
  );
}
