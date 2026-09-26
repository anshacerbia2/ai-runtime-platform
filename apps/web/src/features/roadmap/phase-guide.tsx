import { Badge } from '../../design-system/components/badge';
import { Panel, PanelHeader } from '../../design-system/components/panel';

const phases = [
  [
    'M0',
    'Contract baseline',
    'Contract Lab, schemas, persistence, and local developer verification.',
    'complete',
  ],
  [
    'M1',
    'Durable foundation',
    'Identity, registries, admission, accounting, audit, artifacts, and runner metadata.',
    'complete',
  ],
  [
    'M2',
    'Model Gateway',
    'OpenRouter + Direct Anthropic, bounded SSE/replay, safe fallback, and durable accounting.',
    'complete',
  ],
  [
    'M3',
    'Agent Runtime',
    'Distributed runners, sandbox, tools, placement, and cancellation.',
    'planned',
  ],
  [
    'M3.5',
    'Production gate',
    'Nonlocal reliability, security, accounting, rollback, and operational evidence.',
    'blocked',
  ],
  [
    'M4+',
    'Adoption & expansion',
    'Application migration, Codex/Gemini adapters, and evidence-driven capability growth.',
    'future',
  ],
] as const;

const commands = [
  [
    'npm run setup',
    'Prepare PostgreSQL, migrations, and local fixture identities.',
  ],
  ['npm run dev', 'Run the API and internal-platform console.'],
  [
    'npm run verify',
    'Run format, lint, architecture, types, contracts, integration, build, and docs checks.',
  ],
  [
    'npm run test:e2e',
    'Run browser flows including responsive and Control Plane coverage.',
  ],
];

export function PhaseGuide() {
  return (
    <div className="delivery-layout">
      <Panel>
        <PanelHeader
          title="Milestone map"
          description="Implementation status is separated from external production evidence."
          aside={<Badge tone="info">Dependency driven</Badge>}
        />
        <div className="milestone-list">
          {phases.map(([id, title, description, status]) => (
            <article className="milestone-row" key={id}>
              <div className="milestone-id">{id}</div>
              <div>
                <strong>{title}</strong>
                <p>{description}</p>
              </div>
              <Badge
                tone={
                  status === 'complete'
                    ? 'success'
                    : status === 'blocked'
                      ? 'danger'
                      : status === 'planned'
                        ? 'warning'
                        : 'neutral'
                }
              >
                {status.toUpperCase()}
              </Badge>
            </article>
          ))}
        </div>
      </Panel>
      <Panel>
        <PanelHeader
          title="Local verification commands"
          description="The repository keeps local implementation evidence executable."
        />
        <div className="command-list">
          {commands.map(([command, description]) => (
            <div className="command-row" key={command}>
              <code>{command}</code>
              <p>{description}</p>
            </div>
          ))}
        </div>
        <div className="reference-note">
          M0-M2 are locally implemented. Authorized live provider smoke, live
          ATI Keycloak, deployed Redis/secret-manager, M3 agent runtime, and
          production-readiness evidence remain external gates.
        </div>
      </Panel>
    </div>
  );
}
