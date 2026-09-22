const frameworks =
  /^(?:@nestjs\/|fastify(?:$|\/)|@prisma\/|pg$|react(?:$|\/)|node:)/;

export function dependencyViolation(
  file,
  dependency,
  target,
  typeOnly = false,
  clientDirective = false,
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
  const web = file.startsWith('apps/web/');
  const server = file.startsWith('apps/web/src/server/');
  if (
    web &&
    /(?:@nestjs|@prisma|^pg$|^postgres$|^mysql|^sqlite)/.test(dependency)
  ) {
    return 'Web/BFF code cannot import domain database infrastructure.';
  }
  if (web && dependency.startsWith('node:') && !server) {
    return 'Node built-ins belong only in the server-only web boundary.';
  }
  if (
    web &&
    !server &&
    (target.includes('/server/') || target === 'config/environment.mjs') &&
    ((!file.startsWith('apps/web/src/app/') &&
      file !== 'apps/web/src/proxy.ts') ||
      clientDirective)
  ) {
    return 'Client-reachable modules cannot import server-only code or configuration.';
  }
  if (
    file.startsWith('apps/web/src/design-system/') &&
    (target.includes('/features/') || target.includes('/app/'))
  ) {
    return 'Design-system components cannot depend on features or route modules.';
  }
  if (
    file.startsWith('apps/web/src/shared/') &&
    target.includes('/features/')
  ) {
    return 'Shared frontend components must not depend on a feature.';
  }
  return null;
}
