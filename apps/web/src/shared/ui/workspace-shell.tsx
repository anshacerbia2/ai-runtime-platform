import type { ReactNode } from 'react';

export type WorkspaceTab =
  'playground' | 'control-plane' | 'contracts' | 'history' | 'phases';
const tabs: { id: WorkspaceTab; number: string; label: string }[] = [
  { id: 'playground', number: '01', label: 'Contract Lab' },
  { id: 'control-plane', number: '02', label: 'Control Plane' },
  { id: 'contracts', number: '03', label: 'Schema explorer' },
  { id: 'history', number: '04', label: 'Riwayat validasi' },
  { id: 'phases', number: '05', label: 'Panduan fase' },
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
          <span className="brand-mark">AI</span>
          <span>
            AI Runtime<small>PLATFORM CONSOLE</small>
          </span>
        </a>
        <div className="workspace">
          <span className="dot" /> Local development{' '}
          <span className="chip">M1 · IN PROGRESS</span>
        </div>
        <div className="nav-label">PLATFORM WORKSPACE</div>
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
            Contract Lab tetap tersedia sebagai developer tool. Control Plane
            sekarang berkembang sebagai fondasi durable M1.
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
            M1 FOUNDATION <span className="dot" />
          </span>
        </header>
        <section className="page">
          {children}
          <footer className="page-footer">
            <span>AI Runtime Platform · Local Console</span>
            <span>M1 foundation · belum untuk produksi.</span>
          </footer>
        </section>
      </main>
    </div>
  );
}
