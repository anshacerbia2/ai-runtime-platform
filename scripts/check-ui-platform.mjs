// Checks the UI Platform intake (ADR-0033): each vendored tarball's sha256 matches the pin, the web
// workspace depends on exactly the pinned tarballs, and the lockfile resolves them from there.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const vendor = resolve(root, 'vendor/ui-platform');
const pin = JSON.parse(readFileSync(resolve(vendor, 'pin.json'), 'utf8'));
const web = JSON.parse(
  readFileSync(resolve(root, 'apps/web/package.json'), 'utf8'),
);
const lock = JSON.parse(
  readFileSync(resolve(root, 'package-lock.json'), 'utf8'),
);
const violations = [];

if (!/^[0-9a-f]{40}$/.test(pin.commit ?? '')) {
  violations.push('pin.json: commit is not a full SHA-1');
}

for (const pkg of pin.packages ?? []) {
  const tarball = resolve(vendor, pkg.tarball);
  let digest;
  try {
    digest = createHash('sha256').update(readFileSync(tarball)).digest('hex');
  } catch {
    violations.push(
      `${pkg.name}: vendor/ui-platform/${pkg.tarball} is missing`,
    );
    continue;
  }
  if (digest !== pkg.sha256) {
    violations.push(
      `${pkg.name}: sha256 ${digest} does not match the pin ${pkg.sha256}`,
    );
  }

  const spec = `file:../../vendor/ui-platform/${pkg.tarball}`;
  if (web.dependencies?.[pkg.name] !== spec) {
    violations.push(
      `${pkg.name}: apps/web/package.json must depend on ${spec}`,
    );
  }

  const locked = lock.packages?.[`node_modules/${pkg.name}`];
  if (!locked) {
    violations.push(`${pkg.name}: not in package-lock.json`);
  } else {
    if (locked.version !== pkg.version) {
      violations.push(
        `${pkg.name}: locked at ${locked.version}, pinned at ${pkg.version}`,
      );
    }
    if (locked.resolved !== `file:vendor/ui-platform/${pkg.tarball}`) {
      violations.push(
        `${pkg.name}: locked from ${locked.resolved}, not the vendored tarball`,
      );
    }
  }
}

if (violations.length) {
  console.error(['UI Platform intake violations:', ...violations].join('\n'));
  process.exitCode = 1;
} else {
  console.log(
    `UI Platform intake: ${pin.packages.length} packages match the pin at ${pin.commit.slice(0, 12)}.`,
  );
}
