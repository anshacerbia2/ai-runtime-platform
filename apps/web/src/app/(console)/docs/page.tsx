import { requireConsoleUser } from '../../../server/auth/console-user';
import Link from 'next/link';
import { documents } from '../../../server/docs/catalogue';
import { webConfig } from '../../../server/runtime';
import { PageHeader } from '../../../design-system/compositions/page-header';

export const metadata = { title: 'Documentation' };

export default async function DocumentsPage() {
  await requireConsoleUser();
  const entries = await documents(webConfig().docsRoot);
  return (
    <>
      <PageHeader
        eyebrow="Knowledge"
        title="Documentation"
        description="Architecture, decisions, contracts, and operational guides versioned alongside the platform."
      />
      <section className="ds-panel docs-index">
        <h2>Project documents</h2>
        <ul>
          {entries.map((entry) => (
            <li key={entry.file}>
              <Link href={'/docs/' + entry.slug.join('/')}>{entry.title}</Link>
              <small>{entry.file}</small>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
