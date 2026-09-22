import type { LabResources } from '../../shared/api/lab-client.js';
import { Badge } from '../../design-system/components/badge.js';
import { usePlayground } from './hooks/use-playground.js';
import { ScenarioPicker } from './components/scenario-picker.js';
import { RequestEditor } from './components/request-editor.js';
import { ValidationReport } from './components/validation-report.js';

export function ContractLabPage({
  resources,
  onSaved,
  onHistory,
  onError,
}: {
  resources: LabResources;
  onSaved(): Promise<void>;
  onHistory(): void;
  onError(error: string): void;
}) {
  const lab = usePlayground(resources.examples, onSaved, onError);
  let profile;
  try {
    const payload = JSON.parse(lab.payload) as { profile?: string };
    profile = resources.profiles.find(
      (item) => item.profile === payload.profile,
    );
  } catch {
    // Incomplete JSON has no resolved profile yet.
  }

  return (
    <div className="contract-workbench">
      <div className="workbench-stage">
        <aside className="workbench-scenarios">
          <ScenarioPicker
            examples={resources.examples}
            selected={lab.selected}
            onChoose={lab.choose}
          />
        </aside>
        <RequestEditor
          kind={lab.kind}
          payload={lab.payload}
          idempotencyKey={lab.key}
          busy={lab.busy}
          onKind={lab.editKind}
          onPayload={lab.editPayload}
          onKey={lab.setKey}
          onFormat={lab.format}
          onValidate={lab.validate}
        />
        <ValidationReport
          saved={lab.saved}
          profile={profile}
          onHistory={onHistory}
        />
      </div>
      <section
        className="execution-boundary"
        aria-label="Contract validation boundary"
      >
        <div>
          <span className="ds-eyebrow">Execution boundary</span>
          <strong>Contract validation stops before provider execution.</strong>
        </div>
        <div className="boundary-flow">
          <Badge>Frontend</Badge>
          <span>→</span>
          <Badge>Nest use case</Badge>
          <span>→</span>
          <Badge>PostgreSQL</Badge>
          <span>→</span>
          <Badge tone="success">Durable result</Badge>
        </div>
      </section>
    </div>
  );
}
