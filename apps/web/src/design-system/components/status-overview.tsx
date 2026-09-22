import type { LabHealth } from '../../shared/api/lab-client';
import { Badge } from './badge';
import { MetricCard } from './metric-card';

export function StatusOverview({ health }: { health?: LabHealth }) {
  return (
    <section className="ds-metric-grid" aria-label="Local platform status">
      <MetricCard
        label="API"
        value={health ? 'Healthy' : 'Connecting'}
        detail="NestJS / Fastify"
        status={
          <Badge tone={health ? 'success' : 'warning'}>
            {health ? 'Online' : 'Pending'}
          </Badge>
        }
      />
      <MetricCard
        label="Database"
        value={health?.database ?? 'Checking'}
        detail="Prisma / PostgreSQL"
        status={
          <Badge tone={health ? 'success' : 'warning'}>
            {health ? 'Durable' : 'Pending'}
          </Badge>
        }
      />
      <MetricCard
        label="Validations"
        value={
          <span data-testid="saved-count">{health?.saved_checks ?? '—'}</span>
        }
        detail={health?.application_id ?? 'm0-playground'}
        status={<Badge tone="neutral">records</Badge>}
      />
      <MetricCard
        label="Provider calls"
        value="0"
        detail="Execution disabled in M0"
        status={<Badge tone="info">By design</Badge>}
      />
    </section>
  );
}
