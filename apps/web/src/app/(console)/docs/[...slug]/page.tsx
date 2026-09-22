import { requireConsoleUser } from '../../../../server/auth/console-user';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { documents, renderDocument } from '../../../../server/docs/catalogue';
import { webConfig } from '../../../../server/runtime';

export default async function DocumentPage({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}) {
  await requireConsoleUser();
  const { slug } = await params;
  const root = webConfig().docsRoot;
  const document = await renderDocument(root, slug, await documents(root));
  if (!document) {
    notFound();
  }
  return (
    <>
      <Link href="/docs">← All documentation</Link>
      <article
        className="ds-panel docs-article"
        aria-label={document.title}
        dangerouslySetInnerHTML={{ __html: document.html }}
      />
    </>
  );
}
