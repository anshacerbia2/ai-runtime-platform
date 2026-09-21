import type { ReactNode } from 'react';

export type WorkspaceTab = 'playground' | 'contracts' | 'history' | 'phases';
const tabs: { id: WorkspaceTab; number: string; label: string }[] = [
  { id: 'playground', number: '01', label: 'Contract Lab' },
  { id: 'contracts', number: '02', label: 'Schema explorer' },
  { id: 'history', number: '03', label: 'Riwayat validasi' },
  { id: 'phases', number: '04', label: 'Panduan fase' },
];

interface Props {
  tab: WorkspaceTab;
  onNavigate(tab: WorkspaceTab): void;
  children: ReactNode;
}

export function WorkspaceShell({ tab, onNavigate, children }: Props) {
  return (
    <div className="shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(event) => {
            event.preventDefault();
            onNavigate('playground');
          }}
        >
          <span className="brand-mark">ar</span>
          <span>
            AI Runtime<small>PLATFORM WORKSPACE</small>
          </span>
        </a>
        <div className="workspace">
          <span className="dot" /> Local development{' '}
          <span className="chip">M0</span>
        </div>
        <div className="nav-label">BUILD & UNDERSTAND</div>
        <nav aria-label="Navigasi utama">
          {tabs.map(({ id, number, label }) => (
            <button
              key={id}
              className={tab === id ? 'nav-item active' : 'nav-item'}
              onClick={() => onNavigate(id)}
            >
              <span>{number}</span>
              {label}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <span className="tiny-label">BOUNDARY UTAMA</span>
          <h3>
            App owns workflow.
            <br />
            Platform owns execution.
          </h3>
          <p>
            Validasi M0 bukan eksekusi AI. Tidak ada job bisnis yang berpindah
            ke platform.
          </p>
        </div>
        <div className="sidebar-bottom">
          <span className="dot" /> Loopback only <small>127.0.0.1</small>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <span>
            Workspace <b>/</b> {tabs.find((item) => item.id === tab)?.label}
          </span>
          <span className="mode">
            CONTRACT-ONLY <span className="dot" />
          </span>
        </header>
        <section className="page">
          {children}
          <footer className="page-footer">
            <span>AI Runtime Platform · M0 Contract Lab</span>
            <span>Data sintetis saja. Belum untuk produksi.</span>
          </footer>
        </section>
      </main>
    </div>
  );
}
