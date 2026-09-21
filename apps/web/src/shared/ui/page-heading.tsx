import type { WorkspaceTab } from './workspace-shell.js';

const headings = {
  playground: [
    'Uji kontrak, pahami alurnya.',
    'Coba request aplikasi sebelum menghubungkan provider atau menjalankan agent.',
  ],
  contracts: [
    'Satu sumber kontrak.',
    'JSON Schema dihasilkan dari definisi TypeScript yang juga dipakai backend.',
  ],
  history: [
    'Validasi yang tersimpan.',
    'Data dibaca dari PostgreSQL, bukan daftar sementara di browser.',
  ],
  phases: [
    'Bangun per fase, uji per fase.',
    'Setiap milestone memiliki hasil yang bisa dicoba dan batas yang jelas.',
  ],
};

export function PageHeading({
  tab,
  version,
}: {
  tab: WorkspaceTab;
  version?: string;
}) {
  const [title, description] = headings[tab];
  return (
    <div className="page-heading">
      <div>
        <div className="eyebrow">MILESTONE ZERO</div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <div className="release">
        v{version ?? '1.0.0-m0'}
        <small>LOCAL PREVIEW</small>
      </div>
    </div>
  );
}
