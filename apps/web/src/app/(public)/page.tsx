import Link from 'next/link';
import { webConfig } from '../../server/runtime';
import { SignInSchematic } from '../../features/auth/sign-in-schematic';

export const dynamic = 'force-dynamic';

const capabilities = [
  'Direct chat and structured inference now; agent runtime is the next milestone',
  'Application-scoped routing, policy, and budget',
  'Durable state with auditable accounting',
];

export default async function EntryPage({
  searchParams,
}: {
  searchParams: Promise<{ signIn?: string }>;
}) {
  const config = webConfig();
  const query = await searchParams;

  return (
    <main className="signin">
      <div className="signin-panel">
        <div className="signin-brand">
          <span className="ds-brand-mark" aria-hidden="true">
            AI
          </span>
          <span className="signin-brand-name">AI Runtime Platform</span>
        </div>

        <div className="signin-copy">
          <h1>
            Your app owns the workflow.
            <br />
            The platform owns AI execution.
          </h1>
          <p>
            One shared runtime for the AI work your applications already do — so
            routing, policy, budget, and durable state are handled once instead
            of in every application.
          </p>
        </div>

        <ul className="signin-capabilities">
          {capabilities.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>

        <div className="signin-action">
          {query.signIn === 'failed' ? (
            <p className="signin-alert" role="alert">
              Sign-in could not be completed. Please try again.
            </p>
          ) : null}

          {config.local ? (
            <>
              <Link className="signin-button" href="/contract-lab">
                Open local console
              </Link>
              <p className="signin-note">
                Local M0-M2 · provider gateway implemented; no production
                identity or authorized live vendor smoke.
              </p>
            </>
          ) : (
            <>
              <form action="/auth/login" method="post">
                <button className="signin-button" type="submit">
                  Continue with ATI SSO
                </button>
              </form>
              <p className="signin-note">
                You will be taken to the ATI single sign-on page. This platform
                never receives your password.
              </p>
            </>
          )}
        </div>

        <p className="signin-footer">ATI Business Group</p>
      </div>

      <div className="signin-stage">
        <SignInSchematic />
        <p className="signin-stage-caption">
          Application → managed envelope → runtime
        </p>
      </div>
    </main>
  );
}
