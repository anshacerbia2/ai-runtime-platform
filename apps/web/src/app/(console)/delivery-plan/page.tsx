import { PhaseGuide } from '../../../features/roadmap/phase-guide';
import { PageHeader } from '../../../design-system/compositions/page-header';

export default function Page() {
  return (
    <>
      <PageHeader
        eyebrow="Reference"
        title="Delivery Plan"
        description="Implemented milestones, planned capabilities, and local verification commands."
      />
      <PhaseGuide />
    </>
  );
}
