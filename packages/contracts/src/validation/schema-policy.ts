import type { Issue } from './types.js';

export function schemaIssues(schema: unknown): Issue[] {
  const issues: Issue[] = [];
  let nodes = 0;
  const allowed = new Set([
    'type',
    'properties',
    'required',
    'additionalProperties',
    'enum',
    'items',
    'description',
    'minimum',
    'maximum',
    'minLength',
    'maxLength',
    'minItems',
    'maxItems',
  ]);
  function walk(v: unknown, depth: number, path: string) {
    if (++nodes > 128 || depth > 8) {
      issues.push({
        path,
        code: 'SCHEMA_LIMIT',
        message: 'Schema melebihi batas 128 node / kedalaman 8.',
      });
      return;
    }
    if (!v || typeof v !== 'object' || Array.isArray(v)) {
      issues.push({
        path,
        code: 'INVALID_SCHEMA',
        message: 'Node schema harus object.',
      });
      return;
    }
    const o = v as Record<string, unknown>;
    if (Object.keys(o).some((k) => !allowed.has(k))) {
      issues.push({
        path,
        code: 'SCHEMA_KEYWORD_NOT_ALLOWED',
        message:
          'Keyword schema di luar subset M0; referensi remote dan executable schema tidak didukung.',
      });
      return;
    }
    if (
      ![
        'object',
        'array',
        'string',
        'number',
        'integer',
        'boolean',
        'null',
      ].includes(String(o.type))
    ) {
      issues.push({
        path,
        code: 'INVALID_SCHEMA',
        message: 'type schema harus eksplisit dan didukung.',
      });
    }
    for (const key of [
      'minimum',
      'maximum',
      'minLength',
      'maxLength',
      'minItems',
      'maxItems',
    ]) {
      const value = o[key];
      if (value === undefined) {
        continue;
      }
      const count = key.endsWith('Length') || key.endsWith('Items');
      if (
        typeof value !== 'number' ||
        !Number.isFinite(value) ||
        (count && (!Number.isInteger(value) || value < 0))
      ) {
        issues.push({
          path,
          code: 'INVALID_SCHEMA',
          message:
            'Batas schema harus angka valid; panjang/count harus integer nonnegatif.',
        });
      }
    }
    for (const [lo, hi] of [
      ['minimum', 'maximum'],
      ['minLength', 'maxLength'],
      ['minItems', 'maxItems'],
    ] as const) {
      if (
        typeof o[lo] === 'number' &&
        typeof o[hi] === 'number' &&
        o[lo] > o[hi]
      ) {
        issues.push({
          path,
          code: 'INVALID_SCHEMA',
          message: 'Batas minimum melebihi maximum.',
        });
      }
    }
    if (
      o.description !== undefined &&
      (typeof o.description !== 'string' || o.description.length > 2048)
    ) {
      issues.push({
        path,
        code: 'INVALID_SCHEMA',
        message: 'description harus teks maksimal 2048 karakter.',
      });
    }
    if (
      (o.properties !== undefined && o.type !== 'object') ||
      (o.items !== undefined && o.type !== 'array')
    ) {
      issues.push({
        path,
        code: 'INVALID_SCHEMA',
        message: 'properties/items tidak cocok dengan type.',
      });
    }
    if (o.properties !== undefined) {
      if (
        !o.properties ||
        typeof o.properties !== 'object' ||
        Array.isArray(o.properties)
      ) {
        issues.push({
          path,
          code: 'INVALID_SCHEMA',
          message: 'properties harus object.',
        });
      } else {
        for (const [key, child] of Object.entries(o.properties)) {
          if (
            key === '__proto__' ||
            key === 'constructor' ||
            key === 'prototype'
          ) {
            issues.push({
              path,
              code: 'INVALID_SCHEMA',
              message: 'Nama property tidak diperbolehkan.',
            });
            continue;
          }
          walk(child, depth + 1, path + '/properties/' + key);
        }
      }
    }
    if (o.items !== undefined) {
      walk(o.items, depth + 1, path + '/items');
    }
    if (
      o.required !== undefined &&
      (!Array.isArray(o.required) ||
        o.required.some(
          (x) =>
            typeof x !== 'string' ||
            !o.properties ||
            !Object.hasOwn(o.properties as object, x),
        ))
    ) {
      issues.push({
        path,
        code: 'INVALID_SCHEMA',
        message: 'required harus menunjuk property yang didefinisikan.',
      });
    }
    if (
      o.additionalProperties !== undefined &&
      typeof o.additionalProperties !== 'boolean'
    ) {
      issues.push({
        path,
        code: 'INVALID_SCHEMA',
        message: 'additionalProperties harus boolean pada M0.',
      });
    }
    if (
      o.enum !== undefined &&
      (!Array.isArray(o.enum) ||
        o.enum.length === 0 ||
        o.enum.length > 64 ||
        o.enum.some(
          (x) =>
            x !== null && !['string', 'number', 'boolean'].includes(typeof x),
        ))
    ) {
      issues.push({
        path,
        code: 'INVALID_SCHEMA',
        message: 'enum harus 1–64 nilai scalar.',
      });
    }
  }
  walk(schema, 0, '/input/response_schema');
  return issues.slice(0, 20);
}
