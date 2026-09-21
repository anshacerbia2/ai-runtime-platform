export function ErrorBanner({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss(): void;
}) {
  if (!message) {
    return null;
  }
  return (
    <div className="error-banner" role="alert">
      <b>Perlu diperiksa</b>
      <span>{message}</span>
      <button onClick={onDismiss} aria-label="Tutup error">
        ×
      </button>
    </div>
  );
}
