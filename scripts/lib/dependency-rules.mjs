const frameworks =
  /^(?:@nestjs\/|fastify(?:$|\/)|@prisma\/|pg$|react(?:$|\/)|node:)/;

export function dependencyViolation(
  file,
  dependency,
  target,
  typeOnly = false,
) {
  const inner = /\/(domain|application)\//.test(file);
  if (inner && frameworks.test(dependency)) {
    return 'Inner layers cannot import framework, transport, database, or Node infrastructure.';
  }
  if (inner && /\/(infrastructure|presentation)\//.test(target)) {
    return 'Dependency direction must point inward.';
  }
  if (/\/domain\//.test(file) && /\/application\//.test(target)) {
    return 'Domain cannot depend on use cases.';
  }
  if (inner && dependency === '@ai-runtime/contracts' && !typeOnly) {
    return 'Inner layers may import contract types only; runtime validation belongs behind a port.';
  }
  if (/\/presentation\//.test(file) && /\/infrastructure\//.test(target)) {
    return 'Controllers/guards must depend on use cases or ports, not database adapters.';
  }
  if (/\/infrastructure\//.test(file) && /\/presentation\//.test(target)) {
    return 'Infrastructure cannot depend on HTTP presentation.';
  }
  if (
    file.startsWith('apps/web/') &&
    /(?:@nestjs|@prisma|^pg$|^node:)/.test(dependency)
  ) {
    return 'Browser code cannot import backend infrastructure.';
  }
  if (
    file.startsWith('apps/web/src/shared/') &&
    target.includes('/features/')
  ) {
    return 'Shared frontend components must not depend on a feature.';
  }
  return null;
}
