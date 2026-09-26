import type { LabCatalogue } from '../../shared/api/lab-client';
import { Badge } from '../../design-system/components/badge';
import { usePlayground } from './hooks/use-playground';
import { ScenarioPicker } from './components/scenario-picker';
import { RequestEditor } from './components/request-editor';
import { ValidationReport } from './components/validation-report';

export function ContractLabPage({
  resources,
  onSaved,
  onHistory,
  onError,
}: {
  resources: LabCatalogue;
  onSaved(): Promise<void>;
  onHistory(): void;
  onError(error: Error | null): void;
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
    <div
      className="contract-workbench"
      data-mutation-state={lab.mutation.status}
    >
      {lab.mutation.status === 'unknown' ? (
        <p className="notice" role="status">
          Hasil penyimpanan belum diketahui. Periksa History atau ulangi payload
          dan Idempotency-Key yang sama; jangan buat key baru untuk retry.
        </p>
      ) : null}
      {lab.refreshWarning ? (
        <p className="notice" role="status">
          {lab.refreshWarning.message}
        </p>
      ) : null}
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
