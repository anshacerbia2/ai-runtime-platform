import { useState } from 'react';
import { prettyJson } from '../../shared/lib/json.js';
import { Button } from '../../shared/ui/button.js';
import { Panel, PanelHeader } from '../../shared/ui/panel.js';

export function SchemaExplorer({
  schemas,
  onError,
}: {
  schemas: Record<string, unknown>;
  onError(error: string): void;
}) {
  const [name, setName] = useState('ChatRequest');
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(prettyJson(schemas[name]));
      setCopied(true);
    } catch {
      onError('Clipboard tidak tersedia. Salin dari panel schema.');
    }
  }

  return (
    <Panel>
      <PanelHeader
        title="Contract registry"
        aside={
          <a
            className="text-button"
            href="/api/m0/openapi.json"
            target="_blank"
            rel="noreferrer"
          >
            Buka OpenAPI ↗
          </a>
        }
      />
      <div className="schema-tools">
        <label>
          Schema
          <select
            aria-label="Pilih schema"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setCopied(false);
            }}
          >
            {Object.keys(schemas).map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </label>
        <Button onClick={() => void copy()}>
          {copied ? 'Tersalin' : 'Salin schema'}
        </Button>
      </div>
      <p className="schema-disclaimer">
        Schema /v1 adalah draft kontrak. API /v1 belum dijalankan di M0;
        endpoint aktif hanya /api/m0/*.
      </p>
      <pre className="schema-code">{prettyJson(schemas[name])}</pre>
    </Panel>
  );
}
