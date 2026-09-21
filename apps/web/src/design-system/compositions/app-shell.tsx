import type { ReactNode } from 'react';
import { PageRegion } from './page-region.js';
import { Sidebar } from './sidebar.js';
import { TopBar } from './top-bar.js';
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
  return (
    <div className="ds-app-shell">
      <Sidebar active={active} onNavigate={onNavigate} />
      <main className="ds-app-main">
        <TopBar active={active} />
        <PageRegion>{children}</PageRegion>
      </main>
    </div>
  );
}
