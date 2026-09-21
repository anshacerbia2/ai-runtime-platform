export const prettyJson = (value: unknown): string =>
  JSON.stringify(value, null, 2);
export const newIdempotencyKey = (): string => `lab-${crypto.randomUUID()}`;
