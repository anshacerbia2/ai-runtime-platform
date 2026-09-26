import ts from 'typescript';
/** Syntactic guard: direct roundtrips plus local aliases; not interprocedural taint analysis. */
export function serializationViolations(text, file = 'source.ts') {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const aliases = new Map();
  const failures = [];
  function unwrap(node) {
    while (
      node &&
      (ts.isParenthesizedExpression(node) ||
        ts.isAsExpression(node) ||
        ts.isTypeAssertionExpression(node) ||
        ts.isNonNullExpression(node))
    ) {
      node = node.expression;
    }
    return node;
  }
  function role(node) {
    node = unwrap(node);
    if (!node) {
      return undefined;
    }
    if (ts.isIdentifier(node)) {
      return (
        aliases.get(node.text) ?? (node.text === 'JSON' ? 'json' : undefined)
      );
    }
    if (
      ts.isPropertyAccessExpression(node) ||
      ts.isElementAccessExpression(node)
    ) {
      const base = role(node.expression);
      const key = ts.isPropertyAccessExpression(node)
        ? node.name.text
        : node.argumentExpression && ts.isStringLiteral(node.argumentExpression)
          ? node.argumentExpression.text
          : undefined;
      if (base === 'json' && ['parse', 'stringify'].includes(key)) {
        return key;
      }
      if (
        key === 'JSON' &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'globalThis'
      ) {
        return 'json';
      }
    }
    if (ts.isCallExpression(node) && role(node.expression) === 'stringify') {
      return 'serialized';
    }
    return undefined;
  }
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.initializer) {
      if (ts.isIdentifier(node.name)) {
        aliases.set(node.name.text, role(node.initializer));
      } else if (
        ts.isObjectBindingPattern(node.name) &&
        role(node.initializer) === 'json'
      ) {
        for (const element of node.name.elements) {
          if (ts.isIdentifier(element.name)) {
            const key =
              element.propertyName?.getText(source) ?? element.name.text;
            aliases.set(
              element.name.text,
              key === 'parse' || key === 'stringify' ? key : undefined,
            );
          }
        }
      }
    }
    if (
      ts.isCallExpression(node) &&
      role(node.expression) === 'parse' &&
      role(node.arguments[0]) === 'serialized'
    ) {
      const pos = source.getLineAndCharacterOfPosition(node.getStart(source));
      failures.push(
        file +
          ':' +
          (pos.line + 1) +
          ': replace JSON normalization roundtrip with an explicit shape mapper.',
      );
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return failures;
}
