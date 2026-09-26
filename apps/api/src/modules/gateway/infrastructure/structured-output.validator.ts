import { schemaIssues } from '@ai-runtime/contracts';
import { ApplicationError } from '../../../shared/domain/application-error.js';
import type { StructuredOutputValidator } from '../application/structured-output.port.js';

export class BoundedStructuredOutputValidator implements StructuredOutputValidator {
  validateSchema(schema: unknown) {
    if (schemaIssues(schema).length) {
      throw new ApplicationError(
        'INVALID_REQUEST',
        'Structured response schema is outside the supported bounded subset.',
      );
    }
  }

  parseAndValidate(schema: Record<string, unknown>, text: string) {
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      throw new ApplicationError(
        'STRUCTURED_OUTPUT_INVALID',
        'Provider returned invalid structured JSON.',
      );
    }
    if (!matches(schema, value, 0)) {
      throw new ApplicationError(
        'STRUCTURED_OUTPUT_INVALID',
        'Provider output does not satisfy the requested response schema.',
      );
    }
    return value;
  }
}
function matches(
  schema: Record<string, unknown>,
  value: unknown,
  depth: number,
): boolean {
  if (depth > 8) {
    return false;
  }
  if (
    Array.isArray(schema.enum) &&
    !schema.enum.some((item) => Object.is(item, value))
  ) {
    return false;
  }
  switch (schema.type) {
    case 'null':
      return value === null;
    case 'boolean':
      return typeof value === 'boolean';
    case 'string':
      return (
        typeof value === 'string' &&
        bound(value.length, schema.minLength, schema.maxLength)
      );
    case 'number':
      return (
        typeof value === 'number' &&
        Number.isFinite(value) &&
        numeric(value, schema.minimum, schema.maximum)
      );
    case 'integer':
      return (
        typeof value === 'number' &&
        Number.isInteger(value) &&
        numeric(value, schema.minimum, schema.maximum)
      );
    case 'array':
      return (
        Array.isArray(value) &&
        bound(value.length, schema.minItems, schema.maxItems) &&
        (!schema.items ||
          (typeof schema.items === 'object' &&
            schema.items !== null &&
            value.every((item) =>
              matches(schema.items as Record<string, unknown>, item, depth + 1),
            )))
      );
    case 'object': {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return false;
      }
      const object = value as Record<string, unknown>;
      const properties =
        schema.properties && typeof schema.properties === 'object'
          ? (schema.properties as Record<string, Record<string, unknown>>)
          : {};
      if (
        Array.isArray(schema.required) &&
        schema.required.some(
          (key) => typeof key !== 'string' || !Object.hasOwn(object, key),
        )
      ) {
        return false;
      }
      if (
        schema.additionalProperties === false &&
        Object.keys(object).some((key) => !Object.hasOwn(properties, key))
      ) {
        return false;
      }
      return Object.entries(properties).every(
        ([key, child]) =>
          !Object.hasOwn(object, key) || matches(child, object[key], depth + 1),
      );
    }
    default:
      return false;
  }
}

function bound(value: number, min: unknown, max: unknown) {
  return (
    (typeof min !== 'number' || value >= min) &&
    (typeof max !== 'number' || value <= max)
  );
}

function numeric(value: number, min: unknown, max: unknown) {
  return bound(value, min, max);
}
