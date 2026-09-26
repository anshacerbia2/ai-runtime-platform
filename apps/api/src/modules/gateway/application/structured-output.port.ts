export const STRUCTURED_OUTPUT = Symbol('StructuredOutput');

export interface StructuredOutputValidator {
  validateSchema(schema: unknown): void;
  parseAndValidate(schema: Record<string, unknown>, text: string): unknown;
}
