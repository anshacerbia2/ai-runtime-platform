import type { Example } from '../../../shared/api/lab-client.js';

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
    <>
      <div className="section-title">
        <h2>Pilih skenario</h2>
        <span>01 / SUSUN REQUEST</span>
      </div>
      <div className="scenario-grid">
        {examples.map((example, index) => (
          <button
            key={example.id}
            className={
              'scenario ' + (selected === example.id ? 'selected' : '')
            }
            onClick={() => onChoose(example)}
          >
            <span className="scenario-number">0{index + 1}</span>
            <strong>{example.title}</strong>
            <small>
              {example.id === 'chat'
                ? 'Tanpa job & plugin'
                : example.id === 'structured'
                  ? 'Output dengan schema'
                  : example.id === 'scribe'
                    ? 'Job tetap di aplikasi'
                    : 'Contoh yang harus ditolak'}
            </small>
          </button>
        ))}
      </div>
    </>
  );
}
