import type { Prisma } from '../../infrastructure/database/generated/client.js';
/** Validate finite JSON and its encoded byte budget without a serialization roundtrip. */
export function databaseJson(
  value: unknown,
  maxBytes = 65536,
): Prisma.InputJsonValue {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new RangeError('Invalid JSON byte budget.');
  }
  let nodes = 0;
  let budget = maxBytes;
  const active = new WeakSet<object>();
  const spend = (bytes: number) => {
    budget -= bytes;
    if (budget < 0) {
      throw new RangeError(
        'Database JSON exceeds the bounded storage envelope.',
      );
    }
  };
  const string = (text: string) => {
    spend(Buffer.byteLength(text, 'utf8') + 2);
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      if (code === 34 || code === 92) {
        spend(1);
      } else if (code < 32) {
        spend([8, 9, 10, 12, 13].includes(code) ? 1 : 5);
      } else if (code >= 0xd800 && code <= 0xdbff) {
        const next = text.charCodeAt(i + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          i++;
        } else {
          spend(3);
        }
      } else if (code >= 0xdc00 && code <= 0xdfff) {
        spend(3);
      }
    }
  };
  const walk = (item: unknown, depth: number): void => {
    if (++nodes > 10000 || depth > 32) {
      throw new TypeError('Database JSON complexity exceeded.');
    }
    if (item === null) {
      spend(4);
    } else if (typeof item === 'boolean') {
      spend(item ? 4 : 5);
    } else if (typeof item === 'string') {
      string(item);
    } else if (typeof item === 'number' && Number.isFinite(item)) {
      spend(String(item).length);
    } else if (typeof item === 'object' && item) {
      if (active.has(item)) {
        throw new TypeError('Cyclic database JSON.');
      }
      active.add(item);
      if (Array.isArray(item)) {
        spend(2 + Math.max(0, item.length - 1));
        for (const entry of item) {
          walk(entry, depth + 1);
        }
      } else if (
        Object.getPrototypeOf(item) === Object.prototype ||
        Object.getPrototypeOf(item) === null
      ) {
        const keys = Object.keys(item);
        spend(2 + Math.max(0, keys.length - 1));
        for (const key of keys) {
          const property = Object.getOwnPropertyDescriptor(item, key)!;
          if (!('value' in property)) {
            throw new TypeError('Database JSON cannot contain accessors.');
          }
          string(key);
          spend(1);
          walk(property.value, depth + 1);
        }
      } else {
        throw new TypeError(
          'Database JSON must contain only plain JSON values.',
        );
      }
      active.delete(item);
    } else {
      throw new TypeError(
        'Database JSON must contain only finite JSON values.',
      );
    }
  };
  walk(value, 0);
  if (value === null) {
    throw new TypeError(
      'Top-level database JSON null requires an explicit database null policy.',
    );
  }
  return value as Prisma.InputJsonValue;
}
