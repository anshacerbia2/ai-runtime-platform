import { ControlPlanePage } from '../../../features/control-plane/control-plane-page';
import { PageHeader } from '../../../design-system/compositions/page-header';
import { Badge } from '../../../design-system/components/badge';
import { webConfig } from '../../../server/runtime';

export const metadata = { title: 'Control Plane' };

export default function Page() {
  return (
    <>
      <PageHeader
        eyebrow="Durable foundation"
        title="Control Plane"
        meta={
          <Badge tone="success">
            {webConfig().local ? 'M1 local complete' : 'Durable foundation'}
          </Badge>
        }
        description="Inspect application-scoped registries, policy bindings, budgets, profiles, and runner metadata."
      />
      <ControlPlanePage />
    </>
  );
}
