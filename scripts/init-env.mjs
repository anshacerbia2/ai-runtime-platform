import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const examplePath = resolve(root, '.env.example');
const envPath = resolve(root, '.env');

if (existsSync(envPath)) {
  throw new Error('.env already exists; refusing to overwrite it.');
}

let content = readFileSync(examplePath, 'utf8');
const generated = {
  __GENERATE_DB_PASSWORD__: randomBytes(24).toString('hex'),
  __GENERATE_APP_TOKEN__: randomBytes(32).toString('hex'),
  __GENERATE_TEST_APP_TOKEN__: randomBytes(32).toString('hex'),
};

for (const [marker, value] of Object.entries(generated)) {
  if (!content.includes(marker)) {
    throw new Error(`Missing expected marker in .env.example: ${marker}`);
  }
  content = content.replaceAll(marker, value);
}
if (/__GENERATE_[A-Z_]+__/.test(content)) {
  throw new Error(
    'Unresolved generated-secret marker remains in .env.example.',
  );
}

writeFileSync(envPath, content.endsWith('\n') ? content : `${content}\n`, {
  mode: 0o600,
  flag: 'wx',
});

console.log(
  'Created .env from .env.example. Review PG_BIN and all environment-specific values before npm run setup.',
);
