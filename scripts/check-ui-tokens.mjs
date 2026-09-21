import { readFileSync, readdirSync } from 'node:fs';
import { resolve, relative } from 'node:path';

const root = process.cwd();
const sourceRoot = resolve(root, 'apps/web/src');
const tokenRoot = resolve(sourceRoot, 'design-system/tokens');
const violations = [];

function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      walk(path);
      continue;
    }
    if (!/\.(?:css|tsx?|mjs)$/.test(entry.name) || path.startsWith(tokenRoot)) {
      continue;
    }
    const text = readFileSync(path, 'utf8');
    const name = relative(root, path).replaceAll('\\', '/');
    const lines = text.split(/\r?\n/);
    lines.forEach((line, index) => {
      if (/#[0-9a-f]{3,8}\b|\b(?:rgb|rgba|hsl|hsla|oklch)\s*\(/i.test(line)) {
        violations.push(`${name}:${index + 1} raw color literal`);
      }
      if (
        /(?:padding|margin|gap|border-radius|font-size|box-shadow)\s*:[^;]*(?:\d+(?:\.\d+)?(?:px|rem))\b/i.test(
          line,
        )
      ) {
        violations.push(`${name}:${index + 1} raw visual dimension`);
      }
      if (/style\s*=\s*\{\{/.test(line)) {
        violations.push(`${name}:${index + 1} inline style bypass`);
      }
    });
  }
}

walk(sourceRoot);
if (violations.length) {
  console.error(['UI token boundary violations:', ...violations].join('\n'));
  process.exitCode = 1;
} else {
  console.log('UI token boundary: semantic-token consumption passed.');
}
