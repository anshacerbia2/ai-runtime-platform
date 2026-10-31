const frameworks =
  /^(?:@nestjs\/|fastify(?:$|\/)|@prisma\/|pg$|react(?:$|\/)|node:)/;
const providerSdks =
  /^(?:@anthropic-ai\/|openai(?:$|\/)|@openrouter\/|@ai-sdk\/|ai$|@google\/(?:genai|generative-ai)|@mistralai\/|cohere-ai$)/;
const modules = 'apps/api/src/modules/';
const agentRuntime = `${modules}agent-runtime/`;

// ADR-0034: Model & Inference and Agent Runtime are separate authorities.
function agentRuntimeViolation(file, dependency, target, inner) {
  const insideAgent = file.startsWith(agentRuntime);
  if (
    !insideAgent &&
    target.startsWith(agentRuntime) &&
    file !== 'apps/api/src/app.module.ts'
  ) {
    return 'Only the composition root may depend on Agent Runtime; Model & Inference and other modules never do.';
  }
  if (!insideAgent) {
    return null;
  }
  if (providerSdks.test(dependency)) {
    return 'Agent Runtime calls models through its model-execution port, never a provider SDK.';
  }
  if (target.startsWith(`${modules}gateway/infrastructure/`)) {
    return 'Agent Runtime cannot reach provider adapters; wrap the M2 application boundary instead.';
  }
  if (
    inner &&
    target.startsWith(modules) &&
    !target.startsWith(agentRuntime) &&
    !target.startsWith(`${modules}identity/domain/`)
  ) {
    return 'Agent Runtime inner layers depend only on their own domain and ports.';
  }
  return null;
}

export function dependencyViolation(
  file,
  dependency,
  target,
  typeOnly = false,
  clientDirective = false,
) {
  const inner = /\/(domain|application)\//.test(file);
  const agent = agentRuntimeViolation(file, dependency, target, inner);
  if (agent) {
    return agent;
  }
  const pluginPackage =
    dependency === '@ai-runtime/plugin-package' ||
    dependency.startsWith('@ai-runtime/plugin-package/') ||
    target.startsWith('packages/plugin-package/');
  if (inner && pluginPackage && !typeOnly) {
    return 'Plugin byte verification belongs in infrastructure, behind an application port.';
  }
  if (inner && frameworks.test(dependency)) {
    return 'Inner layers cannot import framework, transport, database, or Node infrastructure.';
  }
  if (inner && /\/(infrastructure|presentation)\//.test(target)) {
    return 'Dependency direction must point inward.';
  }
  if (/\/domain\//.test(file) && /\/application\//.test(target)) {
    return 'Domain cannot depend on use cases.';
  }
  if (
    inner &&
    (dependency === '@ai-runtime/contracts' ||
      dependency.startsWith('@ai-runtime/contracts/')) &&
    !typeOnly
  ) {
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
  if (web && pluginPackage) {
    return 'Plugin package verification belongs only in API/runner processes.';
  }
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
