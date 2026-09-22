import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, relative, dirname } from 'node:path';
import ts from 'typescript';
import { dependencyViolation } from './lib/dependency-rules.mjs';

const root = process.cwd();
const sourceFiles = [];
function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'generated') {
      continue;
    }
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      walk(path);
    } else if (/\.(ts|tsx)$/.test(path)) {
      sourceFiles.push(path);
    }
  }
}
for (const directory of [
  'apps/api/src',
  'apps/web/src',
  'packages/contracts/src',
]) {
  walk(resolve(root, directory));
}
const normalize = (path) => relative(root, path).replaceAll('\\', '/');
function sourceTarget(importer, specifier) {
  if (specifier === '@ai-runtime/contracts') {
    return 'packages/contracts/src/index.ts';
  }
  if (!specifier.startsWith('.')) {
    return specifier;
  }
  const absolute = resolve(dirname(importer), specifier);
  const base = absolute.replace(/\.[cm]?jsx?$/, '');
  const candidates = [
    base + '.ts',
    base + '.tsx',
    resolve(base, 'index.ts'),
    resolve(base, 'index.tsx'),
    absolute,
  ];
  return normalize(candidates.find(existsSync) ?? absolute);
}

const errors = [];
const graph = new Map();
for (const path of sourceFiles) {
  const name = normalize(path);
  const source = ts.createSourceFile(
    path,
    readFileSync(path, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const edges = [];
  function visit(node) {
    let specifier;
    let typeOnly = false;
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifier = node.moduleSpecifier.text;
      typeOnly = ts.isImportDeclaration(node)
        ? Boolean(node.importClause?.isTypeOnly)
        : node.isTypeOnly;
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === 'require'))
    ) {
      const argument = node.arguments[0];
      if (argument && ts.isStringLiteral(argument)) {
        specifier = argument.text;
      } else {
        errors.push(`${name}: dynamic dependency expression is not permitted.`);
      }
    }
    if (specifier) {
      const target = sourceTarget(path, specifier);
      const violation = dependencyViolation(
        name,
        specifier,
        target,
        typeOnly,
        /^['"]use client['"];?/m.test(source.text),
      );
      if (violation) {
        errors.push(`${name} -> ${specifier}: ${violation}`);
      }
      if (!typeOnly && /^(apps|packages)\//.test(target)) {
        edges.push(target);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  graph.set(name, edges);
}
const active = new Set();
const complete = new Set();
function cycles(file, trail = []) {
  if (active.has(file)) {
    errors.push('Dependency cycle: ' + [...trail, file].join(' -> '));
    return;
  }
  if (complete.has(file)) {
    return;
  }
  active.add(file);
  for (const target of graph.get(file) ?? []) {
    cycles(target, [...trail, file]);
  }
  active.delete(file);
  complete.add(file);
}
for (const file of graph.keys()) {
  cycles(file);
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log(
    `Architecture checks: ${sourceFiles.length} files; inward dependencies and runtime cycle rules passed.`,
  );
}
