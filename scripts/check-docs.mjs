import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
const root = process.cwd();
const files = [];
function walk(dir) {
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    if (
      [
        '.git',
        'node_modules',
        '.local',
        'dist',
        'test-results',
        'playwright-report',
      ].includes(item.name)
    ) {
      continue;
    }
    const p = join(dir, item.name);
    if (item.isDirectory()) {
      walk(p);
    } else if (item.name.endsWith('.md')) {
      files.push(p);
    }
  }
}
walk(root);
let links = 0;
const errors = [];
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  if ((text.match(/^```/gm) ?? []).length % 2) {
    errors.push('Unbalanced fence: ' + file);
  }
  for (const match of text.matchAll(/(?<!!)\[[^\]\n]+\]\(([^)]+)\)/g)) {
    const target = match[1];
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#')) {
      continue;
    }
    links++;
    const dest = resolve(
      dirname(file),
      decodeURIComponent(target.split('#')[0]),
    );
    if (!existsSync(dest)) {
      errors.push(file + ' -> ' + target);
    }
  }
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log(
    `Documentation checks: ${files.length} Markdown files, ${links} local links; no missing file targets.`,
  );
}
