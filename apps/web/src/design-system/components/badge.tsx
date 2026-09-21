import type { ReactNode } from 'react';

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: BadgeTone;
}) {
  return <span className={`ds-badge ds-badge-${tone}`}>{children}</span>;
}
