import type { ReactNode } from 'react';

export function DataTable({
  label,
  children,
  fit = false,
}: {
  label: string;
  children: ReactNode;
  fit?: boolean;
}) {
  return (
    <div
      className="ds-table-scroll"
      role="region"
      aria-label={label}
      tabIndex={0}
    >
      <table className={fit ? 'ds-table ds-table-fit' : 'ds-table'}>
        {children}
      </table>
    </div>
  );
}
