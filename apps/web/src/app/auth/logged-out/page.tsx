import Link from 'next/link';

export default function LoggedOutPage() {
  return (
    <main className="entry-page">
      <section className="entry-card ds-panel">
        <h1>Signed out</h1>
        <p>
          Your platform session has ended. Other application sessions are
          unchanged.
        </p>
        <Link href="/">Return to sign in</Link>
      </section>
    </main>
  );
}
