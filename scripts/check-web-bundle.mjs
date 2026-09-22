import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { runInNewContext } from 'node:vm';
import { loadWebEnvironment, projectRoot } from '../config/environment.mjs';

const config = loadWebEnvironment();
const build = resolve(projectRoot, 'apps/web/.next');
const clientRoot = resolve(build, 'static');
if (!existsSync(resolve(build, 'BUILD_ID')) || !existsSync(clientRoot)) {
  throw new Error('Run a production web build before the client-bundle check.');
}

function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}

// Report names and paths only; never print secret values.
const secrets = [
  ['local application token', config.applicationToken],
  ['local operator token', config.operatorToken],
  ['OIDC client secret', config.auth?.clientSecret],
  ['session sealing key', config.auth?.sessionSecret],
  [
    'Redis credential',
    config.auth ? new URL(config.auth.redisUrl).password : undefined,
  ],
].filter(([, value]) => typeof value === 'string' && value.length > 0);
const violations = [];
const clientFiles = files(clientRoot).filter((file) =>
  /\.(js|json|map|css)$/.test(file),
);
for (const file of clientFiles) {
  const text = readFileSync(file, 'utf8');
  for (const [label, value] of secrets) {
    if (text.includes(value)) {
      violations.push(label + ' found in ' + relative(build, file));
    }
  }
  if (
    /M1_OIDC_CLIENT_SECRET|M1_SESSION_SECRET|M1_SESSION_REDIS_URL|M0_DB_PASSWORD/.test(
      text,
    )
  ) {
    violations.push(
      'Private configuration included in ' + relative(build, file),
    );
  }
}

const manifests = files(resolve(build, 'server/app')).filter((file) =>
  file.endsWith('client-reference-manifest.js'),
);
if (!manifests.length) {
  throw new Error('Client reference manifests are missing.');
}
for (const file of manifests) {
  const sandbox = {};
  runInNewContext(readFileSync(file, 'utf8'), sandbox, { timeout: 1000 });
  for (const manifest of Object.values(sandbox.__RSC_MANIFEST ?? {})) {
    for (const name of Object.keys(manifest.clientModules ?? {})) {
      const path = name.replaceAll('\\', '/');
      if (
        /apps\/web\/src\/server\//.test(path) ||
        /node_modules\/(?:openid-client|redis|marked|sanitize-html)\//.test(
          path,
        )
      ) {
        violations.push(
          'Server-only module exposed as a client reference: ' + path,
        );
      }
    }
  }
}
if (violations.length) {
  throw new Error(violations.join('\n'));
}
console.log(
  'Client-bundle check: ' +
    clientFiles.length +
    ' files, ' +
    manifests.length +
    ' manifests; no configured secrets or server-only client references.',
);
