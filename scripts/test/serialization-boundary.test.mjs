import test from 'node:test';
import assert from 'node:assert/strict';
import { serializationViolations } from '../lib/serialization-boundary.mjs';
for (const text of [
  'JSON.parse(JSON.stringify(value))',
  'JSON["parse"]((JSON["stringify"](value)))',
  'const J=JSON;J.parse(J.stringify(value));',
  'const {parse:p,stringify:s}=JSON;p(s(value));',
  'const wire=JSON.stringify(value);JSON.parse(wire);',
  'globalThis.JSON.parse(globalThis.JSON.stringify(value));',
]) {
  test('reject serialization roundtrip ' + text, () =>
    assert.equal(serializationViolations(text).length, 1),
  );
}
for (const text of [
  'JSON.stringify(dto)',
  'JSON.parse(body)',
  '// JSON.parse(JSON.stringify(x))',
  'const doc="JSON.parse(JSON.stringify(x))";',
]) {
  test('allow legitimate serialization ' + text, () =>
    assert.equal(serializationViolations(text).length, 0),
  );
}
