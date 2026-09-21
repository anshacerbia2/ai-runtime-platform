const phases = [
  [
    'M0',
    'Kontrak yang bisa dicoba',
    'Schema + NestJS/Fastify + Prisma + React + PostgreSQL lokal. Tidak ada panggilan provider.',
  ],
  [
    'M1',
    'Fondasi durable',
    'Execution, admission, budget reservation, dan ledger nyata.',
  ],
  ['M2', 'Model Gateway', 'OpenRouter dan pembuktian satu direct adapter.'],
  ['M3', 'Agent Runtime', 'Claude, sandbox, tools, lease, dan cancellation.'],
  [
    'M3.5',
    'Reliability gate',
    'Bukti keamanan, recovery, accounting, dan rollback.',
  ],
  [
    'M4+',
    'Adopsi & perluasan',
    'Migrasi app, Codex, Gemini, dan capability baru.',
  ],
];
const commands = [
  ['npm run setup', 'Siapkan database terpisah dan demo profiles.'],
  ['npm run dev', 'Jalankan frontend dan backend.'],
  [
    'npm run verify',
    'Periksa format, dependency rules, lint, types, kontrak, API/DB, build, dan docs.',
  ],
  ['npm run db:inspect', 'Lihat metadata langsung melalui Prisma.'],
];

export function PhaseGuide() {
  return (
    <div className="phase-list">
      {phases.map(([id, title, description]) => (
        <section
          className={'panel phase ' + (id === 'M1' ? 'current' : '')}
          key={id}
        >
          <div className="phase-badge">{id}</div>
          <div>
            <h2>{title}</h2>
            <p>{description}</p>
          </div>
          <span className="tag">
            {id === 'M0' ? 'BASELINE' : id === 'M1' ? 'IN PROGRESS' : 'PLANNED'}
          </span>
        </section>
      ))}
      <div className="notice">
        M0 menjadi baseline developer tool. M1 sedang berjalan: durable registry
        sudah ada, sementara Keycloak, management authority, admission, dan
        accounting masih harus melewati gate sebelum production.
      </div>
      <section className="panel command-panel">
        <h2>Perintah lokal</h2>
        {commands.map(([command, description]) => (
          <div key={command}>
            <code>{command}</code>
            <p>{description}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
