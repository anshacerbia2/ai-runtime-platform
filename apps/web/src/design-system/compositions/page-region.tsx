import type { ReactNode } from 'react';

export function PageRegion({ children }: { children: ReactNode }) {
  return <div className="ds-page-region">{children}</div>;
}
