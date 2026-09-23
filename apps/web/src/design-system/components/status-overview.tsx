import type { ReactNode } from 'react';
import { Badge, type BadgeTone } from './badge';
import { MetricCard } from './metric-card';

export interface StatusMetric {
  label: string;
  value: ReactNode;
  detail: string;
  badge: string;
  tone: BadgeTone;
  valueTestId?: string;
}

/** Pure presentation. Feature adapters own health, identity, and freshness semantics. */
export function StatusOverview({
  label,
  items,
}: {
  label: string;
  items: readonly StatusMetric[];
}) {
  return (
    <section className="ds-metric-grid" aria-label={label}>
      {items.map((item) => (
        <MetricCard
          key={item.label}
          label={item.label}
          value={
            item.valueTestId ? (
              <span data-testid={item.valueTestId}>{item.value}</span>
            ) : (
              item.value
            )
          }
          detail={item.detail}
          status={<Badge tone={item.tone}>{item.badge}</Badge>}
        />
      ))}
    </section>
  );
}
