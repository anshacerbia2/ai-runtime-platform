import type { ReactNode } from 'react';

export function DataTable({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div
      className="ds-table-scroll"
      role="region"
      aria-label={label}
      tabIndex={0}
    >
      <table className="ds-table">{children}</table>
    </div>
  );
}
