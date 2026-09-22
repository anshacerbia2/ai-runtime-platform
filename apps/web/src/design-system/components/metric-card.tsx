import type { ReactNode } from 'react';
import { Panel } from './panel';

export function MetricCard({
  label,
  value,
  detail,
  status,
}: {
  label: string;
  value: ReactNode;
  detail: string;
  status?: ReactNode;
}) {
  return (
    <Panel className="ds-metric-card">
      <span className="ds-eyebrow">{label}</span>
      <div className="ds-metric-value">{value}</div>
      <div className="ds-metric-detail">
        <span>{detail}</span>
        {status}
      </div>
    </Panel>
  );
}
