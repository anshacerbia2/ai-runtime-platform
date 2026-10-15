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
