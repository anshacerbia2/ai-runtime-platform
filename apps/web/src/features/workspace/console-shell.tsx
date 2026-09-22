'use client';
import type { ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { AppShell } from '../../design-system/compositions/app-shell';
import {
  sectionPaths,
  type AppSection,
} from '../../design-system/compositions/navigation-model';
export function ConsoleShell({
  children,
  user,
}: {
  children: ReactNode;
  user: { name: string; subject: string; local: boolean };
}) {
  const pathname = usePathname();
  const router = useRouter();
  const active =
    (Object.keys(sectionPaths) as AppSection[]).find(
      (section) =>
        pathname === sectionPaths[section] ||
        pathname.startsWith(sectionPaths[section] + '/'),
    ) ?? 'playground';
  return (
    <AppShell
      active={active}
      onNavigate={(section) => router.push(sectionPaths[section])}
      user={user}
    >
      {children}
    </AppShell>
  );
}
