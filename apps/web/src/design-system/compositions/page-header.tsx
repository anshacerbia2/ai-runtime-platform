import type { ReactNode } from 'react';
import { Badge } from '../components/badge.js';

export function PageHeader({
  eyebrow,
  title,
  description,
  meta,
  actions,
}: {
  eyebrow: string;
  title: string;
  description: string;
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="ds-page-header">
      <div className="ds-page-copy">
        <span className="ds-eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <div className="ds-page-context">
        {meta ?? <Badge tone="info">Internal platform</Badge>}
        {actions}
      </div>
    </header>
  );
}
