import 'server-only';

export interface RecordStore {
  get(key: string): Promise<string | null>;
  create(key: string, value: string, ttlMs: number): Promise<boolean>;
  take(key: string): Promise<string | null>;
  remove(key: string): Promise<void>;
  replace(
    key: string,
    expected: string,
    value: string,
    ttlMs: number,
  ): Promise<boolean>;
  removeIf(key: string, expected: string): Promise<void>;
}
