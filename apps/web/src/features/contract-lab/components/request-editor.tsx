import type { ContractKind } from '@ai-runtime/contracts';
import { newIdempotencyKey } from '../../../shared/lib/json.js';
import { Button } from '../../../shared/ui/button.js';
import { Panel, PanelHeader } from '../../../shared/ui/panel.js';
import { Badge } from '../../../shared/ui/badge.js';

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
    <Panel>
      <PanelHeader title="Request editor" aside={<Badge>JSON</Badge>} />
      <div className="editor-options">
        <label>
          Kontrak
          <select
            aria-label="Jenis kontrak"
            value={props.kind}
            onChange={(event) =>
              props.onKind(event.target.value as ContractKind)
            }
          >
            <option value="chat">POST /v1/chat · planned</option>
            <option value="generate">POST /v1/generate · planned</option>
            <option value="execution">POST /v1/executions · planned</option>
          </select>
        </label>
        <Button variant="text" onClick={props.onFormat}>
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
      <div className="key-row">
        <label htmlFor="key">Idempotency-Key</label>
        <div>
          <input
            id="key"
            value={props.idempotencyKey}
            onChange={(event) => props.onKey(event.target.value)}
            spellCheck={false}
          />
          <Button
            variant="text"
            onClick={() => props.onKey(newIdempotencyKey())}
          >
            Key baru
          </Button>
        </div>
        <small>Key yang sama + payload sama mengembalikan record semula.</small>
      </div>
      <div className="panel-footer">
        <span>Hanya validasi & simpan metadata</span>
        <Button
          variant="primary"
          onClick={() => void props.onValidate()}
          disabled={props.busy}
        >
          {props.busy ? 'Memeriksa…' : 'Validasi & simpan'} <span>↗</span>
        </Button>
      </div>
    </Panel>
  );
}
