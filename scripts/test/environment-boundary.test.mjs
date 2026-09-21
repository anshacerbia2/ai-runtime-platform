import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { loadEnvironment } from '../../config/environment.mjs';

const root = resolve(import.meta.dirname, '../..');

test('required environment values fail closed instead of falling back', () => {
  loadEnvironment();
  const prior = process.env.M0_API_PORT;
  process.env.M0_API_PORT = '';
  try {
    assert.throws(
      () => loadEnvironment(),
      /Missing required environment variable: M0_API_PORT/,
    );
  } finally {
    process.env.M0_API_PORT = prior;
  }
});

test('boolean environment values require explicit true or false', () => {
  const prior = process.env.M0_MANAGE_POSTGRES;
  process.env.M0_MANAGE_POSTGRES = 'yes';
  try {
    assert.throws(() => loadEnvironment(), /must be exactly true or false/);
  } finally {
    process.env.M0_MANAGE_POSTGRES = prior;
  }
});
test('source code has one environment read boundary and no legacy local config', () => {
  const violations = [];
  const roots = ['apps', 'scripts'];
  function walk(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (['node_modules', 'dist', 'generated'].includes(entry.name)) {
        continue;
      }
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        walk(path);
      } else if (/\.(?:ts|tsx|mjs)$/.test(entry.name)) {
        if (
          path === resolve(root, 'scripts/test/environment-boundary.test.mjs')
        ) {
          continue;
        }
        const text = readFileSync(path, 'utf8');
        if (text.includes('.local/config.json')) {
          violations.push(`${relative(root, path)} reads legacy local config`);
        }
        if (/process\.env\.[A-Z_]/.test(text)) {
          violations.push(`${relative(root, path)} reads process.env directly`);
        }
      }
    }
  }
  for (const directory of roots) {
    walk(resolve(root, directory));
  }
  assert.deepEqual(violations, []);
});
