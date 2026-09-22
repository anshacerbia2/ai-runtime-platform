'use client';

export default function ConsoleError({
  reset,
}: {
  error: Error;
  reset(): void;
}) {
  return (
    <section className="ds-panel entry-card" role="alert">
      <h1>Workspace unavailable</h1>
      <p>Please retry. No operation has been automatically repeated.</p>
      <button
        className="ds-button ds-button-secondary ds-button-md"
        onClick={reset}
      >
        Try again
      </button>
    </section>
  );
}
