import { z } from 'zod';

export const responseEvolutionPolicy = {
  providerUnknownFields: 'project-declared-fields',
  consumerUnknownFields: 'ignore-additive-properties',
  responseMutation: 'forbidden',
} as const;

export class ResponseProjectionError extends Error {
  constructor() {
    super('Response does not satisfy the declared provider contract.');
    this.name = 'ResponseProjectionError';
  }
}

/**
 * Provider boundary policy:
 * - validate declared fields;
 * - return Zod's projected DTO so undeclared object properties cannot leak;
 * - never use response schemas for coercion/defaulting/transforms.
 *
 * Consumer compatibility is separate: exported OpenAPI keeps object responses
 * additive-tolerant so older readers may ignore fields introduced later.
 */
export function projectProviderResponse<T extends z.ZodType>(
  schema: T,
  value: unknown,
): z.output<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ResponseProjectionError();
  }
  return result.data;
}
export function assertProjectionSafeResponseSource(source: string): void {
  const forbidden = [
    ['.transform(', 'transform'],
    ['.default(', 'default'],
    ['.catch(', 'catch'],
    ['z.preprocess(', 'preprocess'],
    ['z.coerce.', 'coerce'],
  ] as const;
  const found = forbidden.find(([needle]) => source.includes(needle));
  if (found) {
    throw new Error(
      'HTTP response contracts must be projection-only; forbidden ' +
        found[1] +
        ' operation found.',
    );
  }
}
