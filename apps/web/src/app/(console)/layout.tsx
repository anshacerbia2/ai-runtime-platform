import type { ReactNode } from 'react';
import { requireConsoleUser } from '../../server/auth/console-user';
import { ConsoleShell } from '../../features/workspace/console-shell';

export const dynamic = 'force-dynamic';

export default async function ConsoleLayout({
  children,
}: {
  children: ReactNode;
}) {
  const user = await requireConsoleUser();
  return <ConsoleShell user={user}>{children}</ConsoleShell>;
}
