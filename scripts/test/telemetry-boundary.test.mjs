import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, relative } from 'node:path';

const root = resolve(import.meta.dirname, '../..');

function source(path) {
  return readFileSync(resolve(root, path), 'utf8');
}

function walk(directory, visit) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (['node_modules', 'dist', 'generated', '.next'].includes(entry.name)) {
      continue;
    }
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      walk(path, visit);
    } else if (/\.(?:ts|tsx)$/.test(entry.name)) {
      visit(path);
    }
  }
}
test('OpenTelemetry remains an infrastructure concern', () => {
  const violations = [];
  walk(resolve(root, 'apps/api/src/modules'), (path) => {
    const normalized = path.replaceAll('\\', '/');
    if (
      !normalized.includes('/application/') &&
      !normalized.includes('/domain/')
    ) {
      return;
    }
    if (readFileSync(path, 'utf8').includes('@opentelemetry')) {
      violations.push(relative(root, path));
    }
  });
  assert.deepEqual(violations, []);
});

test('telemetry implementation never emits token-delta events or baggage', () => {
  const files = [
    'apps/api/src/infrastructure/telemetry/telemetry.ts',
    'apps/api/src/infrastructure/telemetry/http-telemetry.ts',
    'apps/api/src/modules/gateway/infrastructure/opentelemetry-gateway.telemetry.ts',
    'apps/web/src/server/telemetry/telemetry.ts',
  ];
  const combined = files.map(source).join('\n').toLowerCase();
  assert.doesNotMatch(combined, /\.addevent\s*\(/);
  assert.doesNotMatch(combined, /createbaggage|setbaggage|\bbaggage\b/);
  assert.doesNotMatch(combined, /model\.delta|token\.delta/);
});

test('telemetry attributes do not admit raw prompt, output, or credential material', () => {
  const files = [
    'apps/api/src/infrastructure/telemetry/telemetry.ts',
    'apps/api/src/infrastructure/telemetry/http-telemetry.ts',
    'apps/api/src/modules/gateway/infrastructure/opentelemetry-gateway.telemetry.ts',
    'apps/web/src/server/telemetry/telemetry.ts',
  ];
  const combined = files.map(source).join('\n').toLowerCase();
  for (const forbidden of [
    'prompt',
    'raw_output',
    'raw.output',
    'credentialref',
    'api_key',
    'authorization',
    'event.text',
  ]) {
    assert.equal(combined.includes(forbidden), false, forbidden);
  }
});
test('telemetry baseline emits no metrics until a low-cardinality metric contract exists', () => {
  const files = [
    'apps/api/src/infrastructure/telemetry/telemetry.ts',
    'apps/api/src/infrastructure/telemetry/http-telemetry.ts',
    'apps/api/src/modules/gateway/infrastructure/opentelemetry-gateway.telemetry.ts',
    'apps/web/src/server/telemetry/telemetry.ts',
  ];
  const combined = files.map(source).join('\n');
  assert.doesNotMatch(
    combined,
    /getMeter|createCounter|createHistogram|createObservable|createUpDownCounter/,
  );
});

test('gateway tracing exposes bounded phases only, not arbitrary telemetry events', () => {
  const port = source(
    'apps/api/src/modules/gateway/application/gateway-telemetry.port.ts',
  );
  assert.match(port, /admission<T>/);
  assert.match(port, /provider<T>/);
  assert.doesNotMatch(port, /event|delta|payload|message/i);
});
