import test from 'node:test';
import assert from 'node:assert/strict';
import { dependencyViolation } from '../lib/dependency-rules.mjs';

test('plugin verifier stays outside web/BFF and is allowed in API/runner infrastructure', () => {
  assert.ok(
    dependencyViolation(
      'apps/api/src/modules/plugin-registry/application/check.ts',
      '@ai-runtime/plugin-package',
      'packages/plugin-package/src/index.ts',
    ),
  );
  for (const file of [
    'apps/web/src/server/read.ts',
    'apps/web/src/features/view.tsx',
  ]) {
    assert.ok(
      dependencyViolation(
        file,
        '@ai-runtime/plugin-package',
        'packages/plugin-package/src/index.ts',
      ),
    );
    assert.ok(
      dependencyViolation(
        file,
        '../../../../packages/plugin-package/src/index.ts',
        'packages/plugin-package/src/index.ts',
      ),
    );
  }
  for (const file of [
    'apps/api/src/modules/plugin-registry/infrastructure/reader.ts',
    'apps/runner/src/plugin-bundle.ts',
  ]) {
    assert.equal(
      dependencyViolation(
        file,
        '@ai-runtime/plugin-package',
        'packages/plugin-package/src/index.ts',
      ),
      null,
    );
  }
});

for (const dependency of [
  '@nestjs/common',
  'fastify',
  '@prisma/client',
  'pg',
  'node:fs',
]) {
  test(`inner layer rejects ${dependency}`, () => {
    assert.ok(
      dependencyViolation(
        'apps/api/src/modules/lab/domain/model.ts',
        dependency,
        dependency,
      ),
    );
  });
}
test('application rejects infrastructure imports', () => {
  assert.ok(
    dependencyViolation(
      'apps/api/src/modules/lab/application/check.ts',
      '../infrastructure/repo.js',
      'apps/api/src/modules/lab/infrastructure/repo.ts',
    ),
  );
});
test('HTTP presentation rejects database imports', () => {
  assert.ok(
    dependencyViolation(
      'apps/api/src/modules/lab/presentation/http/check.ts',
      '../../infrastructure/repo.js',
      'apps/api/src/modules/lab/infrastructure/repo.ts',
    ),
  );
});
test('composition may wire infrastructure to use cases', () => {
  assert.equal(
    dependencyViolation(
      'apps/api/src/modules/lab/lab.module.ts',
      './infrastructure/repo.js',
      'apps/api/src/modules/lab/infrastructure/repo.ts',
    ),
    null,
  );
});
test('type-only common contracts are allowed inward', () => {
  assert.equal(
    dependencyViolation(
      'apps/api/src/modules/lab/domain/model.ts',
      '@ai-runtime/contracts',
      '@ai-runtime/contracts',
      true,
    ),
    null,
  );
});

// AR-T01 (ADR-0034): Model & Inference never depends on Agent Runtime, and
// Agent Runtime reaches models only through its own port.
const agent = 'apps/api/src/modules/agent-runtime';
test('AR-T01 no other module depends on Agent Runtime, even for types', () => {
  for (const file of [
    'apps/api/src/modules/gateway/application/gateway.service.ts',
    'apps/api/src/modules/gateway/infrastructure/openrouter.adapter.ts',
    'apps/api/src/modules/control-plane/application/m1-control-plane.service.ts',
    'apps/runner/src/runner-worker.ts',
  ]) {
    for (const typeOnly of [false, true]) {
      assert.ok(
        dependencyViolation(
          file,
          '../../agent-runtime/application/model-execution.port.js',
          `${agent}/application/model-execution.port.ts`,
          typeOnly,
        ),
        `${file} typeOnly=${typeOnly}`,
      );
    }
  }
  assert.equal(
    dependencyViolation(
      'apps/api/src/app.module.ts',
      './modules/agent-runtime/agent-runtime.module.js',
      `${agent}/agent-runtime.module.ts`,
    ),
    null,
  );
});
test('AR-T01 Agent Runtime never imports a provider SDK or adapter', () => {
  for (const dependency of [
    '@anthropic-ai/sdk',
    '@anthropic-ai/claude-agent-sdk',
    'openai',
    '@openrouter/ai-sdk-provider',
    '@ai-sdk/anthropic',
  ]) {
    for (const file of [
      `${agent}/domain/operation-state.ts`,
      `${agent}/application/model-execution.port.ts`,
      `${agent}/infrastructure/gateway-model-execution.adapter.ts`,
    ]) {
      assert.ok(
        dependencyViolation(file, dependency, dependency),
        `${file} -> ${dependency}`,
      );
    }
  }
  assert.ok(
    dependencyViolation(
      `${agent}/infrastructure/gateway-model-execution.adapter.ts`,
      '../../gateway/infrastructure/anthropic.adapter.js',
      'apps/api/src/modules/gateway/infrastructure/anthropic.adapter.ts',
    ),
  );
});
test('AR-T01 Agent Runtime inner layers depend only on owned values and ports', () => {
  for (const target of [
    'apps/api/src/modules/gateway/application/gateway.service.ts',
    'apps/api/src/modules/control-plane/application/m1-repository.port.ts',
    'apps/api/src/modules/tool-effects/application/tool-effect.port.ts',
  ]) {
    for (const typeOnly of [false, true]) {
      assert.ok(
        dependencyViolation(
          `${agent}/application/advance-run.use-case.ts`,
          '../../x.js',
          target,
          typeOnly,
        ),
        `${target} typeOnly=${typeOnly}`,
      );
    }
  }
  for (const target of [
    `${agent}/domain/operation-state.ts`,
    'apps/api/src/modules/identity/domain/principal.ts',
    'apps/api/src/shared/domain/application-error.ts',
  ]) {
    assert.equal(
      dependencyViolation(
        `${agent}/application/model-execution.port.ts`,
        '../x.js',
        target,
        true,
      ),
      null,
      target,
    );
  }
});
test('AR-T01 Agent Runtime adapters may wrap the M2 application boundary', () => {
  assert.equal(
    dependencyViolation(
      `${agent}/infrastructure/gateway-model-execution.adapter.ts`,
      '../../gateway/application/gateway.service.js',
      'apps/api/src/modules/gateway/application/gateway.service.ts',
    ),
    null,
  );
});

// Next.js has two execution contexts, but neither owns domain persistence.
test('BFF may use Node built-ins but never a domain database', () => {
  assert.equal(
    dependencyViolation(
      'apps/web/src/server/docs/read.ts',
      'node:fs',
      'node:fs',
    ),
    null,
  );
  assert.ok(
    dependencyViolation(
      'apps/web/src/server/read.ts',
      '@prisma/client',
      '@prisma/client',
    ),
  );
  assert.ok(
    dependencyViolation('apps/web/src/features/view.tsx', 'node:fs', 'node:fs'),
  );
  assert.ok(
    dependencyViolation(
      'apps/web/src/features/view.tsx',
      '../../server/auth',
      'apps/web/src/server/auth.ts',
    ),
  );
  assert.ok(
    dependencyViolation(
      'apps/web/src/app/view.tsx',
      '../server/auth',
      'apps/web/src/server/auth.ts',
      false,
      true,
    ),
  );
  assert.equal(
    dependencyViolation(
      'apps/web/src/app/api/route.ts',
      '../../server/auth',
      'apps/web/src/server/auth.ts',
    ),
    null,
  );
});
