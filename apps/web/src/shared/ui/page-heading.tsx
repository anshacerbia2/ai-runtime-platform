import type { WorkspaceTab } from './workspace-shell.js';

const headings = {
  playground: [
    'Uji kontrak, pahami alurnya.',
    'Coba request aplikasi sebelum menghubungkan provider atau menjalankan agent.',
  ],
  'control-plane': [
    'Control plane yang durable.',
    'Lihat application registry, AI connections, dan credential bindings tanpa mengekspos secret.',
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
  const milestone =
    tab === 'control-plane' ? 'MILESTONE ONE' : 'DEVELOPER TOOL';
  return (
    <div className="page-heading">
      <div>
        <div className="eyebrow">{milestone}</div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <div className="release">
        {version ? `contract ${version}` : 'control plane'}
        <small>LOCAL CONSOLE</small>
      </div>
    </div>
  );
}
