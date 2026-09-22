import type { Example } from '../../../shared/api/lab-client.js';

function scenarioNote(id: string) {
  if (id === 'chat') {
    return 'Direct request · no business job';
  }
  if (id === 'structured') {
    return 'Typed output contract';
  }
  if (id === 'scribe') {
    return 'Workflow remains app-owned';
  }
  return 'Negative authorization case';
}

export function ScenarioPicker({
  examples,
  selected,
  onChoose,
}: {
  examples: Example[];
  selected: string;
  onChoose(example: Example): void;
}) {
  return (
    <section className="scenario-section" aria-labelledby="scenario-heading">
      <div className="section-heading">
        <div>
          <span className="ds-eyebrow">Request fixture</span>
          <h2 id="scenario-heading">Choose a validation scenario</h2>
        </div>
        <span className="section-hint">Canonical examples</span>
      </div>
      <div className="scenario-grid">
        {examples.map((example) => (
          <button
            key={example.id}
            className={`scenario-card ${selected === example.id ? 'is-selected' : ''}`}
            onClick={() => onChoose(example)}
            aria-pressed={selected === example.id}
            // The note is context for the fixture, not a third line the
            // narrow rail has room for.
            title={scenarioNote(example.id)}
          >
            <span className="scenario-kicker">{example.id}</span>
            <strong>{example.title}</strong>
          </button>
        ))}
      </div>
    </section>
  );
}
