import { useState } from 'react';
import { prettyJson } from '../../shared/lib/json';
import { Button } from '../../design-system/primitives/button';
import { Badge } from '../../design-system/components/badge';
import { Panel, PanelHeader } from '../../design-system/components/panel';

export function SchemaExplorer({
  schemas,
  onError,
}: {
  schemas: Record<string, unknown>;
  onError(error: string): void;
}) {
  const names = Object.keys(schemas);
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
    <div className="schema-layout">
      <Panel className="schema-catalogue">
        <PanelHeader
          title="Contract catalogue"
          description={`${names.length} generated schemas`}
          aside={<Badge tone="info">TypeScript source</Badge>}
        />
        <div className="schema-list" role="list" aria-label="Schema catalogue">
          {names.map((item) => (
            <button
              key={item}
              role="listitem"
              className={`schema-list-item ${name === item ? 'is-active' : ''}`}
              onClick={() => {
                setName(item);
                setCopied(false);
              }}
            >
              <span>{item}</span>
              <small>JSON Schema</small>
            </button>
          ))}
        </div>
      </Panel>
      <Panel className="schema-viewer">
        <PanelHeader
          title={name}
          description="Generated contract used by the validation boundary."
          aside={
            <div className="inline-actions">
              <a
                className="ds-link-button"
                href="/api/m0/openapi.json"
                target="_blank"
                rel="noreferrer"
              >
                OpenAPI ↗
              </a>
              <Button size="sm" onClick={() => void copy()}>
                {copied ? 'Copied' : 'Copy schema'}
              </Button>
            </div>
          }
        />
        <div className="schema-banner">
          <Badge tone="warning">Draft runtime</Badge>
          <span>
            /v1 schemas describe the target API; M0 serves validation endpoints
            under /api/m0.
          </span>
        </div>
        <pre className="code-surface schema-code">
          {prettyJson(schemas[name])}
        </pre>
      </Panel>
    </div>
  );
}
