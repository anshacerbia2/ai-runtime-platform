import Link from 'next/link';
import { webConfig } from '../../server/runtime';
import { Panel } from '../../design-system/components/panel';
import { Button } from '../../design-system/primitives/button';

export const dynamic = 'force-dynamic';

export default async function EntryPage({
  searchParams,
}: {
  searchParams: Promise<{ signIn?: string }>;
}) {
  const config = webConfig();
  const query = await searchParams;
  return (
    <main className="entry-page">
      <Panel className="entry-card">
        <span className="ds-brand-mark" aria-hidden="true">
          AI
        </span>
        <span className="ds-eyebrow">AI Runtime Platform</span>
        <h1>
          One platform.
          <br />
          Your applications.
        </h1>
        <p>
          Manage application access, connection policies, and durable runtime
          foundations in one workspace.
        </p>
        {query.signIn === 'failed' ? (
          <p role="alert">Sign-in could not be completed. Please try again.</p>
        ) : null}
        {config.local ? (
          <>
            <p className="privacy-note">
              Local development · no production identity or provider calls.
            </p>
            <Link
              className="ds-button ds-button-primary ds-button-md"
              href="/contract-lab"
            >
              Open local console
            </Link>
          </>
        ) : (
          <form action="/auth/login" method="post">
            <Button type="submit" variant="primary">
              Sign in with Keycloak
            </Button>
          </form>
        )}
      </Panel>
    </main>
  );
}
