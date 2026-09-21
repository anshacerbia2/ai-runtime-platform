import type { HTMLAttributes, ReactNode } from 'react';

export function Panel({
  className = '',
  children,
  ...props
}: HTMLAttributes<HTMLElement> & { children: ReactNode }) {
  return (
    <section className={`ds-panel ${className}`.trim()} {...props}>
      {children}
    </section>
  );
}

export function PanelHeader({
  title,
  description,
  aside,
}: {
  title: ReactNode;
  description?: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <header className="ds-panel-header">
      <div>
        <h2>{title}</h2>
        {description ? <p>{description}</p> : null}
      </div>
      {aside}
    </header>
  );
}
