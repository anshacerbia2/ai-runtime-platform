import type { ReactNode } from 'react';

export function EmptyState({
  title,
  description,
  icon,
}: {
  title: string;
  description: string;
  icon?: ReactNode;
}) {
  return (
    <div className="ds-empty-state">
      {icon ? <div className="ds-empty-icon">{icon}</div> : null}
      <strong>{title}</strong>
      <p>{description}</p>
    </div>
  );
}
