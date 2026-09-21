import type { ContractKind } from '@ai-runtime/contracts';
import { newIdempotencyKey } from '../../../shared/lib/json.js';

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
    <section className="panel">
      <div className="panel-head">
        <h2>Request editor</h2>
        <span className="tag">JSON</span>
      </div>
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
        <button className="text-button" onClick={props.onFormat}>
          Format JSON
        </button>
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
          <button
            className="text-button"
            onClick={() => props.onKey(newIdempotencyKey())}
          >
            Key baru
          </button>
        </div>
        <small>Key yang sama + payload sama mengembalikan record semula.</small>
      </div>
      <div className="panel-footer">
        <span>Hanya validasi & simpan metadata</span>
        <button
          className="primary"
          onClick={() => void props.onValidate()}
          disabled={props.busy}
        >
          {props.busy ? 'Memeriksa…' : 'Validasi & simpan'} <span>↗</span>
        </button>
      </div>
    </section>
  );
}
