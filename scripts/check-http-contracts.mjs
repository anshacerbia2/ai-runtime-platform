import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

const failures = [];
function files(root) {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(root, entry.name);
    return entry.isDirectory()
      ? files(path)
      : /\.[cm]?[jt]sx?$/.test(entry.name)
        ? [path]
        : [];
  });
}
const roots = [
  'apps/web/src/features',
  'apps/web/src/shared/api',
  'apps/web/src/server/api-gateway',
];
for (const file of roots.flatMap(files)) {
  const text = readFileSync(file, 'utf8');
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  function visit(node) {
    if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      /^\/api\/(?:m[01]|v1|runner\/v1)(?:\/|$)/.test(node.text)
    ) {
      failures.push(
        file + ': endpoint literals belong in the shared contract.',
      );
    }
    if (
      ts.isInterfaceDeclaration(node) &&
      [
        'LabHealth',
        'SavedValidation',
        'HistoryResponse',
        'Snapshot',
        'OperatorSnapshot',
      ].includes(node.name.text)
    ) {
      failures.push(
        file + ': duplicated wire DTO; infer from shared contracts.',
      );
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
}
for (const file of [
  'apps/api/src/modules/contract-lab/presentation/http',
  'apps/api/src/modules/control-plane/presentation/http',
  'apps/api/src/modules/gateway/presentation/http',
]
  .flatMap(files)
  .filter((file) => file.endsWith('.controller.ts'))) {
  const text = readFileSync(file, 'utf8');
  if (
    /@(?:Get|Post|Put|Patch|Delete)\s*\(/.test(text) ||
    !text.includes('@ContractRoute(')
  ) {
    failures.push(
      file + ': implemented HTTP endpoints must bind the shared contract.',
    );
  }
}
if (failures.length) {
  throw new Error(failures.join('\n'));
}
console.log(
  'Contract boundary PASS: no manual implemented API client URLs or duplicated wire DTOs; all provider controllers bind shared routes.',
);
