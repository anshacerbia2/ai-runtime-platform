import { useState } from 'react';
import { prettyJson } from '../../shared/lib/json.js';

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
    <section className="panel">
      <div className="panel-head">
        <h2>Contract registry</h2>
        <a
          className="text-button"
          href="/api/m0/openapi.json"
          target="_blank"
          rel="noreferrer"
        >
          Buka M0 OpenAPI ↗
        </a>
      </div>
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
        <button className="secondary" onClick={() => void copy()}>
          {copied ? 'Tersalin' : 'Salin schema'}
        </button>
      </div>
      <p className="schema-disclaimer">
        Schema /v1 adalah draft kontrak. API /v1 belum dijalankan di M0;
        endpoint aktif hanya /api/m0/*.
      </p>
      <pre className="schema-code">{prettyJson(schemas[name])}</pre>
    </section>
  );
}
