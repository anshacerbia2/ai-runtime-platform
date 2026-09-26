import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { serializationViolations } from './lib/serialization-boundary.mjs';
function files(root) {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) =>
    entry.name === 'generated'
      ? []
      : entry.isDirectory()
        ? files(join(root, entry.name))
        : /\.[cm]?[jt]sx?$/.test(entry.name)
          ? [join(root, entry.name)]
          : [],
  );
}
const targets = files('apps/api/src');
const failures = targets.flatMap((file) =>
  serializationViolations(readFileSync(file, 'utf8'), file),
);
if (failures.length) {
  throw new Error(failures.join('\n'));
}
console.log(
  'Serialization boundary PASS: ' +
    targets.length +
    ' authored API source files checked.',
);
