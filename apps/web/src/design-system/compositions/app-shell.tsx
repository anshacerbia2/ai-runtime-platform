import type { ReactNode } from 'react';
import { PageRegion } from './page-region.js';
import { Sidebar } from './sidebar.js';
import { TopBar } from './top-bar.js';
import { useSidebar } from './use-sidebar.js';
import type { AppSection } from './navigation-model.js';

export type { AppSection } from './navigation-model.js';

export function AppShell({
  active,
  onNavigate,
  children,
}: {
  active: AppSection;
  onNavigate(section: AppSection): void;
  children: ReactNode;
}) {
  const { collapsed, toggle, close, closeAfterNavigate } = useSidebar();

  function navigate(section: AppSection) {
    onNavigate(section);
    closeAfterNavigate();
  }

  return (
    <div className={collapsed ? 'ds-app-shell is-collapsed' : 'ds-app-shell'}>
      <Sidebar
        active={active}
        collapsed={collapsed}
        onNavigate={navigate}
        onToggle={toggle}
      />
      <div className="ds-sidebar-scrim" onClick={close} aria-hidden="true" />
      <div className="ds-app-main">
        <TopBar active={active} onToggle={toggle} />
        <main>
          <PageRegion>{children}</PageRegion>
        </main>
      </div>
    </div>
  );
}
