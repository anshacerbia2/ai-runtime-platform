import 'server-only';
import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { join, relative, resolve, sep, posix } from 'node:path';
import { marked, Renderer } from 'marked';
import sanitizeHtml from 'sanitize-html';

export interface DocumentEntry {
  slug: string[];
  title: string;
  file: string;
}

export async function documents(directory: string): Promise<DocumentEntry[]> {
  const root = await realpath(directory);
  const results: DocumentEntry[] = [];
  async function visit(folder: string) {
    const entries = await readdir(folder, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        continue;
      }
      const file = join(folder, entry.name);
      if (entry.isDirectory()) {
        await visit(file);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        const rel = relative(root, file).split(sep).join('/');
        const text = await readFile(file, 'utf8');
        const title = /^#\s+(.+)$/m.exec(text)?.[1] ?? entry.name;
        results.push({ file: rel, slug: rel.slice(0, -3).split('/'), title });
      }
    }
  }
  await visit(root);
  return results.sort((a, b) => a.file.localeCompare(b.file));
}

export async function renderDocument(
  directory: string,
  slug: string[],
  catalogue: DocumentEntry[],
) {
  if (
    !slug.length ||
    slug.some((segment) => !/^[A-Za-z0-9_-]+$/.test(segment))
  ) {
    return null;
  }
  const document = catalogue.find(
    (item) => item.slug.join('/') === slug.join('/'),
  );
  if (!document) {
    return null;
  }
  const root = await realpath(directory);
  const file = await realpath(resolve(root, document.file));
  if (!file.startsWith(root + sep) || !(await stat(file)).isFile()) {
    return null;
  }
  const text = await readFile(file, 'utf8');
  const counts = new Map<string, number>();
  const renderer = new Renderer();
  renderer.heading = function ({ depth, tokens }) {
    const content = this.parser.parseInline(tokens);
    const plain = sanitizeHtml(content, {
      allowedTags: [],
      allowedAttributes: {},
    });
    const base =
      plain
        .toLowerCase()
        .replace(/[^\p{L}\p{N}_ -]/gu, '')
        .replace(/ /g, '-') || 'section';
    const count = counts.get(base) ?? 0;
    counts.set(base, count + 1);
    const id = count ? base + '-' + count : base;
    return '<h' + depth + ' id="' + id + '">' + content + '</h' + depth + '>';
  };
  const html = await marked.parse(text, { async: true, gfm: true, renderer });
  const allowed = new Set(catalogue.map((item) => item.file));
  const safe = sanitizeHtml(html, {
    allowedTags: [...sanitizeHtml.defaults.allowedTags, 'details', 'summary'],
    allowedAttributes: {
      a: ['href', 'title', 'rel'],
      h1: ['id'],
      h2: ['id'],
      h3: ['id'],
      h4: ['id'],
      h5: ['id'],
      h6: ['id'],
      code: ['class'],
      th: ['align'],
      td: ['align'],
    },
    allowedSchemes: ['https', 'http'],
    transformTags: {
      a: (_tag, attributes) => {
        const href = attributes.href ?? '';
        let link: string | undefined;
        if (/^https?:\/\//i.test(href) || href.startsWith('#')) {
          link = href;
        } else {
          const [target, anchor] = href.split('#');
          let decoded = '';
          try {
            decoded = decodeURIComponent(target);
          } catch {
            /* No link for malformed input. */
          }
          const relativeFile = posix.normalize(
            posix.join(posix.dirname(document.file), decoded),
          );
          if (allowed.has(relativeFile)) {
            link =
              '/docs/' +
              relativeFile.slice(0, -3) +
              (anchor ? '#' + anchor : '');
          }
        }
        const attribs: Record<string, string> = {};
        if (link) {
          attribs.href = link;
          attribs.rel = 'noreferrer noopener';
        }
        return { tagName: 'a', attribs };
      },
    },
  });
  return { title: document.title, html: safe };
}
