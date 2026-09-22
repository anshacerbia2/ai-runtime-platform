import type { ReactNode } from 'react';
import { PageRegion } from './page-region';
import { Sidebar } from './sidebar';
import { TopBar } from './top-bar';
import { useSidebar } from './use-sidebar';
import type { AppSection } from './navigation-model';

export type { AppSection } from './navigation-model';

export function AppShell({
  active,
  onNavigate,
  children,
  user,
}: {
  active: AppSection;
  onNavigate(section: AppSection): void;
  children: ReactNode;
  user: { name: string; subject: string; local: boolean };
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
        <TopBar active={active} onToggle={toggle} user={user} />
        <main>
          <PageRegion>{children}</PageRegion>
        </main>
      </div>
    </div>
  );
}
