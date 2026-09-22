import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { documents, renderDocument } from '../src/server/docs/catalogue';

test('G39 server Markdown rejects path traversal and strips script, event handlers and unsafe links', async () => {
  const root = await mkdtemp(join(tmpdir(), 'runtime-docs-'));
  try {
    await mkdir(join(root, 'guides'));
    await writeFile(
      join(root, 'INDEX.md'),
      [
        '# Project docs',
        '[Guide](guides/guide.md)',
        '<script>alert(1)</script>',
        '<img src=x onerror=alert(1)>',
        '',
        '[Unsafe](javascript:alert(1))',
        '<a href="javascript:alert(1)">Unsafe HTML link</a>',
      ].join('\n'),
    );
    await writeFile(
      join(root, 'guides', 'guide.md'),
      '# Guide\n[Back](../INDEX.md)\n',
    );
    const entries = await documents(root);
    assert.equal(entries.length, 2);
    const result = await renderDocument(root, ['INDEX'], entries);
    assert.ok(result?.html.includes('/docs/guides/guide'));
    assert.doesNotMatch(result!.html, /<script|onerror|href=["']javascript:/);
    assert.equal(await renderDocument(root, ['..', 'private'], entries), null);
    assert.equal(
      await renderDocument(root, ['%2e%2e', 'private'], entries),
      null,
    );
    assert.equal(await renderDocument(root, ['missing'], entries), null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
