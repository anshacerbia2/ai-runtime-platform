import type { ContractKind } from '@ai-runtime/contracts';
import { newIdempotencyKey } from '../../../shared/lib/json.js';
import { Button } from '../../../design-system/primitives/button.js';
import { Panel, PanelHeader } from '../../../design-system/components/panel.js';
import { Badge } from '../../../design-system/components/badge.js';

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
        <label className="ds-field">
          <span>Contract</span>
          <select
            aria-label="Jenis kontrak"
            value={props.kind}
            onChange={(event) =>
              props.onKind(event.target.value as ContractKind)
            }
          >
            <option value="chat">POST /v1/chat · planned runtime</option>
            <option value="generate">
              POST /v1/generate · planned runtime
            </option>
            <option value="execution">
              POST /v1/executions · planned runtime
            </option>
          </select>
        </label>
        <Button variant="ghost" size="sm" onClick={props.onFormat}>
          Format JSON
        </Button>
      </div>
      <textarea
        aria-label="Payload JSON"
        className="code-editor"
        spellCheck={false}
        value={props.payload}
        onChange={(event) => props.onPayload(event.target.value)}
      />
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
