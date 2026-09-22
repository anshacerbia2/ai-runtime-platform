import type { ContractKind } from '@ai-runtime/contracts';
import { newIdempotencyKey } from '../../../shared/lib/json.js';
import { Button } from '../../../design-system/primitives/button.js';
import { Panel, PanelHeader } from '../../../design-system/components/panel.js';
import { Badge } from '../../../design-system/components/badge.js';
import {
  Select,
  type SelectOption,
} from '../../../design-system/primitives/select.js';

const contractOptions: SelectOption[] = [
  { value: 'chat', label: 'POST /v1/chat · planned runtime' },
  { value: 'generate', label: 'POST /v1/generate · planned runtime' },
  { value: 'execution', label: 'POST /v1/executions · planned runtime' },
];

interface Props {
  kind: ContractKind;
  payload: string;
  idempotencyKey: string;
  busy: boolean;
  onKind(kind: ContractKind): void;
  onPayload(payload: string): void;
  onKey(key: string): void;
  onFormat(): void;
  onValidate(): Promise<void>;
}

export function RequestEditor(props: Props) {
  return (
    <Panel className="workbench-editor">
      <PanelHeader
        title="Request editor"
        description="Edit the application-owned payload. Platform identity and routing stay server-controlled."
        aside={<Badge tone="info">JSON</Badge>}
      />
      <div className="editor-toolbar">
        <div className="ds-field">
          <span id="contract-kind-label">Contract</span>
          <Select
            label="Jenis kontrak"
            value={props.kind}
            options={contractOptions}
            onChange={(next) => props.onKind(next as ContractKind)}
          />
        </div>
        <Button variant="ghost" size="sm" onClick={props.onFormat}>
          Format JSON
        </Button>
      </div>
      <div className="code-frame">
        <div className="code-frame-bar" aria-hidden="true">
          <span>payload.json</span>
          <span>{props.payload.split('\n').length} lines</span>
        </div>
        <textarea
          aria-label="Payload JSON"
          className="code-editor"
          spellCheck={false}
          value={props.payload}
          onChange={(event) => props.onPayload(event.target.value)}
        />
      </div>
      <div className="idempotency-box">
        <div>
          <label htmlFor="key">Idempotency-Key</label>
          <small>
            Same key + same payload replays the existing durable record.
          </small>
        </div>
        <div className="idempotency-control">
          <input
            id="key"
            value={props.idempotencyKey}
            onChange={(event) => props.onKey(event.target.value)}
            spellCheck={false}
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => props.onKey(newIdempotencyKey())}
          >
            New key
          </Button>
        </div>
      </div>
      <footer className="workbench-footer">
        <span>Validation only · provider calls remain disabled</span>
        <Button
          variant="primary"
          onClick={() => void props.onValidate()}
          disabled={props.busy}
        >
          {props.busy ? 'Checking…' : 'Validasi & simpan'}
        </Button>
      </footer>
    </Panel>
  );
}
