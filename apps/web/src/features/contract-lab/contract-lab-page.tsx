import type { LabResources } from '../../shared/api/lab-client.js';
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
    /* An incomplete editor document has no resolved profile. */
  }

  return (
    <>
      <ScenarioPicker
        examples={resources.examples}
        selected={lab.selected}
        onChoose={lab.choose}
      />
      <div className="work-grid">
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
      <div className="flow-strip">
        <b>Contract validation flow</b>
        <span>Frontend</span>
        <i>→</i>
        <span>Nest use case</span>
        <i>→</i>
        <span>Prisma / PostgreSQL</span>
        <i>→</i>
        <span>Hasil ke frontend</span>
        <small>Tidak menuju provider</small>
      </div>
    </>
  );
}
